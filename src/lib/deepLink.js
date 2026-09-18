// ============================================================
// Deep-link into the Create Task modal from an external tool.
//
// Another app (e.g. the WordPress dev-comments plugin) opens:
//   /dashboard?new=1&page=<url>&feedback=<text>&noticed=<name>&source=<id>
//
// We capture those params at app boot — BEFORE React/auth run — stash them in
// sessionStorage, and strip the query from the address bar immediately. That
// way the params survive a login round-trip (sessionStorage persists in the
// tab), a refresh won't reopen the modal, and the URL stays clean. The
// Dashboard consumes the stash once it mounts (post-auth).
// ============================================================

const KEY = 'tf-newtask-deeplink';
const TTL_MS = 15 * 60 * 1000;   // stale stash is ignored after 15 min
const MAX_PAGE = 2048;
const MAX_FEEDBACK = 20000;      // truncate absurdly long bodies rather than break
const MAX_NAME = 200;
const MAX_ATTACHMENTS = 10;
// Attachments may only come from the dev site's uploads dir (also enforced
// server-side in /api/fetch-attachment).
const ATTACH_PREFIX = 'https://dev.palmerindustries.com/wp-content/uploads/';

const DEEPLINK_PARAMS = ['new', 'page', 'feedback', 'noticed', 'source', 'attachments'];

function parseAttachments(raw) {
  return String(raw || '')
    .split('|')
    .map(s => s.trim())
    .filter(u => u.startsWith(ATTACH_PREFIX))
    .slice(0, MAX_ATTACHMENTS);
}

const clamp = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Run once, as early as possible (see index.js). No-op unless `new` is
// present. Only STASHES the params (survives a login redirect); the URL is
// cleaned later by clearDeepLinkFromUrl() once the modal has actually opened,
// so a render failure can never both blank the page AND lose the params.
export function captureNewTaskDeepLink() {
  try {
    const p = new URL(window.location.href).searchParams;
    if (!p.get('new')) return;

    const data = {
      page: clamp(p.get('page') || '', MAX_PAGE).trim(),
      feedback: clamp(p.get('feedback') || '', MAX_FEEDBACK),
      noticed: clamp(p.get('noticed') || '', MAX_NAME).trim(),
      source: clamp(p.get('source') || '', MAX_NAME),
      attachments: parseAttachments(p.get('attachments')),
      ts: Date.now(),
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
  } catch { /* malformed URL — nothing to do */ }
}

// Strip our params from the address bar (keeps any others). Call this only
// after the modal is up, so a refresh won't reopen and the URL stays clean.
export function clearDeepLinkFromUrl() {
  try {
    const url = new URL(window.location.href);
    let touched = false;
    DEEPLINK_PARAMS.forEach(k => { if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; } });
    if (!touched) return;
    const qs = url.searchParams.toString();
    window.history.replaceState(null, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
  } catch { /* no history / malformed — leave the URL as-is */ }
}

// Read-and-clear the stash. Returns null if none / stale / malformed.
export function consumeNewTaskDeepLink() {
  let raw = null;
  try { raw = sessionStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (Date.now() - (Number(data.ts) || 0) > TTL_MS) return null;
    return {
      page: typeof data.page === 'string' ? data.page : '',
      feedback: typeof data.feedback === 'string' ? data.feedback : '',
      noticed: typeof data.noticed === 'string' ? data.noticed : '',
      source: typeof data.source === 'string' ? data.source : '',
      attachments: Array.isArray(data.attachments) ? parseAttachments(data.attachments.join('|')) : [],
    };
  } catch { return null; }
}
