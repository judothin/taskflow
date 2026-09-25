import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { searchRank } from '../lib/fuzzySearch';
import Avatar from '../components/Avatar';
import './GoLive.css';

// ══════════════════════════════════════════════════════════════
// Go Live
// --------------------------------------------------------------
// Things that are done on dev and still have to be pushed to live. One card
// per change: the page it's on, what changed, and the files that have to go
// up with it. Files are free text on purpose — this isn't the Files tab,
// it's a deploy note ("header.php — needs the matching CSS").
//
// Ticking one off marks it live rather than deleting it, so a mis-click is a
// tap on Undo (or Restore, later) instead of lost notes.
// ══════════════════════════════════════════════════════════════

const EMPTY = { page: '', description: '', files: '' };
const SELECT = '*, creator:profiles!created_by(first_name, last_name, color, avatar_url)';

const isUrl = (s) => /^https?:\/\/\S+$/i.test((s || '').trim());
const shortUrl = (s) => {
  try {
    const u = new URL(s);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '')) || s;
  } catch { return s; }
};

// One file per line; anything after a dash is a note about that file.
const NOTE_SPLIT = /\s+[—–-]\s+/;
export function parseFiles(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(NOTE_SPLIT);
    if (!m) return { path: line, note: '' };
    return { path: line.slice(0, m.index), note: line.slice(m.index + m[0].length) };
  });
}

const ago = (iso) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : '');
const nameOf = (p) => (p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '');

// Plain-text version of an item, for pasting into a deploy ticket or chat.
function itemAsText(item) {
  const lines = [`• ${item.page}`];
  if (item.description) lines.push(...item.description.split('\n').map(l => `  ${l}`));
  const files = parseFiles(item.files);
  if (files.length) {
    lines.push('  Files:');
    files.forEach(f => lines.push(`    - ${f.path}${f.note ? ` (${f.note})` : ''}`));
  }
  return lines.join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// A textarea that grows with its content, so a long file list never hides
// behind a scrollbar inside a scrolling page. Forwards its ref so the page
// field can hand focus on to the description.
const AutoTextarea = React.forwardRef(function AutoTextarea({ value, minRows = 2, ...props }, fwd) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  const setRef = (el) => {
    ref.current = el;
    if (typeof fwd === 'function') fwd(el);
    else if (fwd) fwd.current = el;
  };
  return <textarea ref={setRef} rows={minRows} value={value} {...props} />;
});

const Icon = {
  rocket: <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />,
  page: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  file: <><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><polyline points="13 2 13 9 20 9" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  undo: <><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></>,
  chevron: <polyline points="9 18 15 12 9 6" />,
  link: <><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
};
const Svg = ({ name, size = 15, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {Icon[name]}
  </svg>
);

// ── The three fields, shared by the composer and in-place editing ─────────
function ItemFields({ value, onChange, onSubmit, onCancel, autoFocusPage, pageRef }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  // Enter in the page field moves on rather than submitting half an item;
  // Ctrl/⌘+Enter anywhere saves, Esc backs out.
  const keys = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const descRef = useRef(null);

  return (
    <div className="gl-fields" onKeyDown={keys}>
      <label className="gl-field">
        <span className="gl-field-label">Page</span>
        <input
          ref={pageRef}
          className="input gl-input"
          autoFocus={autoFocusPage}
          placeholder="e.g. /contact-us  or  https://site.com/pricing"
          value={value.page}
          onChange={set('page')}
          onKeyDown={e => {
            if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); descRef.current?.focus(); }
          }}
        />
      </label>
      <label className="gl-field">
        <span className="gl-field-label">Description <span className="gl-field-hint">what changed</span></span>
        <AutoTextarea
          ref={descRef}
          className="input gl-input gl-textarea"
          minRows={3}
          placeholder="New hero section and the updated pricing table. Tested on dev, signed off by the client."
          value={value.description}
          onChange={set('description')}
        />
      </label>
      <label className="gl-field">
        <span className="gl-field-label">Files <span className="gl-field-hint">one per line — add a note after a dash</span></span>
        <AutoTextarea
          className="input gl-input gl-textarea gl-mono"
          minRows={3}
          placeholder={'wp-content/themes/site/header.php — new nav markup\nwp-content/themes/site/style.css\nElementor template "Pricing v2" — export & import it'}
          value={value.files}
          onChange={set('files')}
          spellCheck={false}
        />
      </label>
    </div>
  );
}

function FileList({ text }) {
  const files = parseFiles(text);
  if (!files.length) return null;
  return (
    <ul className="gl-files">
      {files.map((f, i) => (
        <li key={i} className="gl-file">
          <span className="gl-file-icon"><Svg name="file" size={13} /></span>
          <span className="gl-file-path">{f.path}</span>
          {f.note && <span className="gl-file-note">{f.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function PageLabel({ page }) {
  if (isUrl(page)) {
    return (
      <a className="gl-page gl-page-link" href={page} target="_blank" rel="noreferrer" title={page}>
        {shortUrl(page)}
        <Svg name="link" size={13} />
      </a>
    );
  }
  return <span className="gl-page">{page}</span>;
}

// ── One pending item ──────────────────────────────────────────
function ItemCard({ item, index, onSave, onMarkLive, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileCount = parseFiles(item.files).length;
  const who = nameOf(item.creator);

  const startEdit = () => {
    setDraft({ page: item.page, description: item.description || '', files: item.files || '' });
    setEditing(true);
  };
  const save = async () => {
    if (!draft.page.trim() || saving) return;
    setSaving(true);
    const ok = await onSave(item.id, draft);
    setSaving(false);
    if (ok) setEditing(false);
  };
  const copyFiles = async () => {
    const text = parseFiles(item.files).map(f => f.path).join('\n');
    if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };

  if (editing) {
    return (
      <article className="gl-card gl-card-editing">
        <ItemFields value={draft} onChange={setDraft} onSubmit={save} onCancel={() => setEditing(false)} autoFocusPage />
        <div className="gl-form-actions">
          <span className="gl-kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to save · <kbd>Esc</kbd> to cancel</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !draft.page.trim()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="gl-card" style={{ '--i': index }}>
      <div className="gl-card-head">
        <span className="gl-card-icon"><Svg name="page" size={16} /></span>
        <div className="gl-card-title">
          <PageLabel page={item.page} />
          <div className="gl-meta">
            {item.creator && (
              <Avatar
                src={item.creator.avatar_url}
                color={item.creator.color || '#6366f1'}
                initials={`${item.creator.first_name?.[0] || ''}${item.creator.last_name?.[0] || ''}`}
                size={18}
              />
            )}
            <span title={item.created_at ? format(new Date(item.created_at), 'PPpp') : undefined}>
              Added {ago(item.created_at)}{who ? ` by ${who}` : ''}
            </span>
          </div>
        </div>

        <div className="gl-card-actions">
          {confirmDel ? (
            <div className="gl-confirm" role="group" aria-label="Confirm delete">
              <span>Delete for good?</span>
              <button type="button" className="gl-confirm-yes" onClick={() => onDelete(item)}>Delete</button>
              <button type="button" className="gl-confirm-no" onClick={() => setConfirmDel(false)}>Keep</button>
            </div>
          ) : (
            <>
              <button type="button" className="gl-icon-btn" onClick={startEdit} title="Edit" aria-label="Edit">
                <Svg name="edit" />
              </button>
              <button type="button" className="gl-icon-btn gl-icon-btn-danger" onClick={() => setConfirmDel(true)} title="Delete" aria-label="Delete">
                <Svg name="trash" />
              </button>
              <button type="button" className="gl-live-btn" onClick={() => onMarkLive(item)}>
                <Svg name="check" size={14} width={3} />
                Mark live
              </button>
            </>
          )}
        </div>
      </div>

      {item.description && <p className="gl-desc">{item.description}</p>}

      {fileCount > 0 && (
        <div className="gl-files-block">
          <div className="gl-files-head">
            <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>
            <button type="button" className="gl-copy" onClick={copyFiles}>
              <Svg name={copied ? 'check' : 'copy'} size={12} width={2.4} />
              {copied ? 'Copied' : 'Copy paths'}
            </button>
          </div>
          <FileList text={item.files} />
        </div>
      )}
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function GoLive() {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const composerPageRef = useRef(null);

  const [showLive, setShowLive] = useState(false);
  const [toast, setToast] = useState(null); // { text, undo }
  const toastTimer = useRef(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeamId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase.from('golive_items').select(SELECT)
      .eq('team_id', activeTeamId).order('created_at', { ascending: false });
    if (error) {
      // Most likely the migration hasn't been run yet — say so plainly.
      setLoadError(/golive_items/.test(error.message)
        ? 'The Go Live table doesn\'t exist yet. Run supabase-golive-migration.sql in the Supabase SQL editor.'
        : error.message);
    } else {
      setLoadError('');
      setItems(data || []);
    }
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const pending = useMemo(
    () => items.filter(i => i.status !== 'live')
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
    [items]);
  const live = useMemo(
    () => items.filter(i => i.status === 'live')
      .sort((a, b) => new Date(b.went_live_at || 0) - new Date(a.went_live_at || 0)),
    [items]);

  const filtered = useMemo(() => searchRank(pending, search, i => [
    { text: i.page, weight: 3 },
    { text: i.description, weight: 1.5 },
    { text: i.files, weight: 1.5 },
  ]), [pending, search]);

  // "N" opens the composer from anywhere on the page, like the rest of the
  // app's single-key shortcuts — but never while you're typing.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setComposerOpen(true);
        setTimeout(() => composerPageRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const showToast = (text, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const closeComposer = () => { setComposerOpen(false); setDraft(EMPTY); setFormError(''); };

  const add = async () => {
    if (!draft.page.trim()) { setFormError('Add the page first — it\'s how you\'ll find this later.'); return; }
    if (adding) return;
    setAdding(true);
    setFormError('');
    const { data, error } = await supabase.from('golive_items').insert({
      team_id: activeTeamId,
      created_by: user?.id,
      page: draft.page.trim(),
      description: draft.description.trim(),
      files: draft.files.trim(),
    }).select(SELECT).single();
    setAdding(false);
    if (error) { setFormError(error.message); return; }
    setItems(prev => [data, ...prev]);
    // Stay open and ready for the next one — you usually add several at once.
    setDraft(EMPTY);
    composerPageRef.current?.focus();
  };

  const saveItem = async (id, d) => {
    const patch = {
      page: d.page.trim(), description: d.description.trim(), files: d.files.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('golive_items').update(patch).eq('id', id);
    if (error) { showToast(`Couldn't save: ${error.message}`); return false; }
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    return true;
  };

  const setStatus = async (item, status) => {
    const patch = {
      status,
      went_live_at: status === 'live' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    // Optimistic — ticking things off should feel instant.
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from('golive_items').update(patch).eq('id', item.id);
    if (error) {
      setItems(prev => prev.map(i => (i.id === item.id ? item : i)));
      showToast(`Couldn't update: ${error.message}`);
      return false;
    }
    return true;
  };

  const markLive = async (item) => {
    if (await setStatus(item, 'live')) {
      showToast(`"${item.page}" marked live`, () => { setStatus({ ...item, status: 'live' }, 'pending'); setToast(null); });
    }
  };
  const restore = async (item) => {
    if (await setStatus(item, 'pending')) showToast(`"${item.page}" is back on the list`);
  };

  // Undo puts the same row back (same id and timestamps), so it lands where
  // it was in the list.
  const restoreDeleted = async (item) => {
    setToast(null);
    const { creator, ...row } = item;
    const { error } = await supabase.from('golive_items').insert(row);
    if (error) { showToast(`Couldn't restore: ${error.message}`); return; }
    setItems(prev => [...prev, item]);
  };

  const remove = async (item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    const { error } = await supabase.from('golive_items').delete().eq('id', item.id);
    if (error) { setItems(prev => [item, ...prev]); showToast(`Couldn't delete: ${error.message}`); return; }
    showToast(`"${item.page}" deleted`, () => restoreDeleted(item));
  };

  const copyAll = async () => {
    const text = pending.map(itemAsText).join('\n\n');
    if (await copyText(text)) { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1600); }
  };

  const totalFiles = useMemo(() => pending.reduce((n, i) => n + parseFiles(i.files).length, 0), [pending]);

  if (!activeTeamId) {
    return <div className="gl-empty">Join or create a team to track what needs to go live.</div>;
  }

  return (
    <div className="gl-page-wrap fade-in">
      <header className="gl-head">
        <div className="gl-head-icon"><Svg name="rocket" size={20} /></div>
        <div className="gl-head-text">
          <h1 className="gl-head-title">Go Live</h1>
          <div className="gl-head-sub">
            {loading ? 'Loading…' : pending.length
              ? `${pending.length} change${pending.length === 1 ? '' : 's'} on dev waiting to go live${totalFiles ? ` · ${totalFiles} file${totalFiles === 1 ? '' : 's'}` : ''}`
              : 'Everything on dev is live'}
          </div>
        </div>

        {pending.length > 0 && (
          <>
            <div className="gl-search">
              <span className="gl-search-icon"><Svg name="search" size={14} /></span>
              <input
                className="gl-search-input"
                placeholder="Search pages, notes, files…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setSearch(''); }}
              />
              {search && (
                <button type="button" className="gl-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                  <Svg name="x" size={12} width={2.5} />
                </button>
              )}
            </div>
            <button type="button" className="btn btn-secondary btn-sm gl-copy-all" onClick={copyAll}
              title="Copy every pending item as text — for a deploy ticket or a message">
              <Svg name={copiedAll ? 'check' : 'copy'} size={13} />
              {copiedAll ? 'Copied' : 'Copy list'}
            </button>
          </>
        )}
      </header>

      {loadError && <div className="error-msg gl-load-error">⚠ {loadError}</div>}

      {/* ── Composer ── */}
      {!loadError && (
        composerOpen ? (
          <section className="gl-card gl-composer gl-composer-open" aria-label="Add an item">
            <div className="gl-composer-title">Add something waiting to go live</div>
            <ItemFields
              value={draft}
              onChange={(d) => { setDraft(d); if (formError) setFormError(''); }}
              onSubmit={add}
              onCancel={closeComposer}
              autoFocusPage
              pageRef={composerPageRef}
            />
            {formError && <div className="error-msg">⚠ {formError}</div>}
            <div className="gl-form-actions">
              <span className="gl-kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to add · <kbd>Esc</kbd> to close</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeComposer} disabled={adding}>Done</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={adding || !draft.page.trim()}>
                <Svg name="plus" size={13} width={2.6} />
                {adding ? 'Adding…' : 'Add to list'}
              </button>
            </div>
          </section>
        ) : (
          <button type="button" className="gl-composer gl-composer-closed" onClick={() => setComposerOpen(true)}>
            <span className="gl-composer-plus"><Svg name="plus" size={16} width={2.6} /></span>
            <span className="gl-composer-prompt">Add something that's on dev and needs to go live…</span>
            <kbd className="gl-composer-kbd">N</kbd>
          </button>
        )
      )}

      {/* ── Pending ── */}
      {loading ? (
        <div className="gl-list">
          {[1, 2, 3].map(i => <div key={i} className="gl-skeleton loading-pulse" />)}
        </div>
      ) : loadError ? null : pending.length === 0 ? (
        <div className="gl-empty">
          <div className="gl-empty-icon"><Svg name="rocket" size={26} /></div>
          <p className="gl-empty-title">Nothing waiting to go live</p>
          <p className="gl-empty-sub">
            When you finish something on dev, add it here with the page, what changed and the files
            that need pushing. Tick it off with <strong>Mark live</strong> once it's up.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="gl-empty">
          <p>Nothing matches <strong>"{search}"</strong>.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
        </div>
      ) : (
        <div className="gl-list">
          {filtered.map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} onSave={saveItem} onMarkLive={markLive} onDelete={remove} />
          ))}
        </div>
      )}

      {/* ── Went live ── */}
      {live.length > 0 && (
        <section className="gl-live">
          <button type="button" className="gl-live-toggle" onClick={() => setShowLive(v => !v)} aria-expanded={showLive}>
            <span className={`gl-live-chev ${showLive ? 'gl-live-chev-open' : ''}`}><Svg name="chevron" size={14} width={2.5} /></span>
            Went live
            <span className="gl-live-count">{live.length}</span>
          </button>
          {showLive && (
            <div className="gl-live-list">
              {live.map(item => (
                <div key={item.id} className="gl-live-row">
                  <span className="gl-live-tick"><Svg name="check" size={12} width={3} /></span>
                  <div className="gl-live-text">
                    <PageLabel page={item.page} />
                    {item.description && <span className="gl-live-desc">{item.description.split('\n')[0]}</span>}
                  </div>
                  <span className="gl-live-when" title={item.went_live_at ? format(new Date(item.went_live_at), 'PPpp') : undefined}>
                    {ago(item.went_live_at)}
                  </span>
                  <button type="button" className="gl-row-btn" onClick={() => restore(item)}>
                    <Svg name="undo" size={12} width={2.4} /> Restore
                  </button>
                  <button type="button" className="gl-row-btn gl-row-btn-danger" onClick={() => remove(item)} aria-label="Delete for good">
                    <Svg name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {toast && (
        <div className="gl-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="gl-toast-undo" onClick={toast.undo}>Undo</button>}
          <button type="button" className="gl-toast-x" onClick={() => setToast(null)} aria-label="Dismiss"><Svg name="x" size={12} width={2.5} /></button>
        </div>
      )}
    </div>
  );
}
