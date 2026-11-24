// ============================================================
// Drafts — typed text survives closing a sheet, clicking away, a refresh
// or a crash.
// ------------------------------------------------------------
//   const [form, setForm, draft] = useDraft('task:new', () => blankForm, { version })
//
// Works like useState. Every change is written to localStorage (debounced,
// and flushed straight away when the field loses focus, the tab hides or the
// component unmounts). Next time the same form mounts with the same key, it
// starts from the draft instead of `initial`, and a "Draft restored" toast
// offers Discard. Call draft.clear() once the thing has been saved, so the
// draft doesn't come back.
//
// - Keys are per signed-in user (guests share "anon").
// - `version` ties a draft to what it was editing (e.g. the row's
//   updated_at): if that changed since, the stale draft is dropped.
// - A value equal to `initial` isn't stored, so opening and closing a form
//   leaves nothing behind.
// - Only JSON goes in: File objects and the like are not kept.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { toast } from '../ui';

const PREFIX = 'tf-draft:';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const SAVE_MS = 250;

const json = (v) => { try { return JSON.stringify(v); } catch { return ''; } };
const resolve = (init) => (typeof init === 'function' ? init() : init);

function readDraft(storageKey, version) {
  if (!storageKey) return undefined;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const d = JSON.parse(raw);
    const stale = !d || Date.now() - (d.at || 0) > MAX_AGE || (d.ver ?? null) !== (version ?? null);
    if (stale) { localStorage.removeItem(storageKey); return undefined; }
    return d.v;
  } catch { return undefined; }
}

function writeDraft(storageKey, version, value) {
  try { localStorage.setItem(storageKey, JSON.stringify({ v: value, ver: version ?? null, at: Date.now() })); }
  catch { /* storage full or blocked — the form still works */ }
}

function removeDraft(storageKey) {
  try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
}

// Several forms restoring on the same open (a review's comment box and its
// verdict note) share one toast, and its Discard throws all of them away.
let pendingRestores = [];
function announceRestore(discard) {
  pendingRestores.push(discard);
  if (pendingRestores.length > 1) return;
  setTimeout(() => {
    const all = pendingRestores;
    pendingRestores = [];
    toast(all.length > 1 ? 'Drafts restored' : 'Draft restored', {
      icon: 'edit',
      action: { label: 'Discard', onClick: () => all.forEach(fn => fn()) },
    });
  }, 0);
}

// Old drafts are pruned once per page load.
let pruned = false;
function pruneOld() {
  if (pruned) return;
  pruned = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        try {
          const d = JSON.parse(localStorage.getItem(k));
          if (!d || Date.now() - (d.at || 0) > MAX_AGE) localStorage.removeItem(k);
        } catch { localStorage.removeItem(k); }
      }
    }
  } catch { /* ignore */ }
}

/**
 * @param {string|null} key   null turns caching off (e.g. a read-only view)
 * @param {*} initial         value or () => value, used when there's no draft
 * @param {{ version?: string|null, announce?: boolean }} [opts]
 * @returns {[any, Function, { clear: (resetTo?: any) => void, discard: () => void, restored: boolean }]}
 */
export default function useDraft(key, initial, { version = null, announce = true } = {}) {
  const { user } = useAuth();
  const storageKey = key ? `${PREFIX}${user?.id || 'anon'}:${key}` : null;

  const initialRef = useRef(undefined);
  if (initialRef.current === undefined) initialRef.current = resolve(initial);

  const [value, setValue] = useState(() => {
    pruneOld();
    const d = readDraft(storageKey, version);
    return d !== undefined ? d : initialRef.current;
  });
  const [restored, setRestored] = useState(() => json(value) !== json(initialRef.current));

  const latest = useRef({ storageKey, version, value });
  latest.current = { storageKey, version, value };
  // After clear(), this value is known to be saved elsewhere, so it isn't
  // written back as a draft until it changes again.
  const suppress = useRef(null);
  const timer = useRef(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    const { storageKey: k, version: ver, value: v } = latest.current;
    if (!k) return;
    const s = json(v);
    if (suppress.current !== null && s === suppress.current) return;
    suppress.current = null;
    if (s === json(initialRef.current)) removeDraft(k);
    else writeDraft(k, ver, v);
  }, []);

  // Write a moment after typing stops.
  useEffect(() => {
    if (!storageKey) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
    return undefined;
  }, [value, storageKey, version, flush]);

  // ...and straight away on clicking off a field, hiding the tab, or closing.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('focusout', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('focusout', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  // Same component, different thing (another post opened in place): save the
  // old draft, then load the new one.
  const loadedKey = useRef(`${storageKey}|${version}`);
  useEffect(() => {
    const id = `${storageKey}|${version}`;
    if (loadedKey.current === id) return;
    loadedKey.current = id;
    initialRef.current = resolve(initial);
    const d = readDraft(storageKey, version);
    suppress.current = null;
    setValue(d !== undefined ? d : initialRef.current);
    setRestored(d !== undefined);
  }, [storageKey, version]);

  const clear = useCallback((resetTo) => {
    clearTimeout(timer.current);
    const { storageKey: k, value: v } = latest.current;
    if (k) removeDraft(k);
    const next = resetTo === undefined ? v : resetTo;
    suppress.current = json(next);
    if (resetTo !== undefined) setValue(resetTo);
    setRestored(false);
  }, []);

  const discard = useCallback(() => clear(initialRef.current), [clear]);

  // Announce once, on mount, if this form came back from a draft.
  const announced = useRef(false);
  useEffect(() => {
    if (!announce || announced.current || !restored) return;
    announced.current = true;
    announceRestore(discard);
  }, [announce, restored, discard]);

  return [value, setValue, { clear, discard, restored }];
}
