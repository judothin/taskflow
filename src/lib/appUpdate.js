// ============================================================
// Picking up a new deploy in an installed app
// ------------------------------------------------------------
// A browser tab gets the new build on its next navigation. A home-screen app
// doesn't: iOS and Android freeze it on background and RESUME it, so it keeps
// running whatever JS and CSS it loaded when it was last cold-started —
// sometimes for days. The symptom is the app looking like an older version of
// itself while the same URL in a browser is current.
//
// The service worker doesn't fix this on its own either. It serves assets fine,
// but nothing re-navigates, so nothing asks it for the new ones.
//
// So on resume, compare the build that's running against the one that's
// deployed, and reload if they differ. The comparison is CRA's asset manifest,
// fetched past every cache.
// ============================================================

import { supabase } from './supabase';

// The running build, read off the script tag the HTML actually loaded.
function runningBundle() {
  const el = document.querySelector('script[src*="/static/js/main."]');
  if (!el) return null;
  try { return new URL(el.src, window.location.origin).pathname; }
  catch { return null; }
}

export async function isStale() {
  const running = runningBundle();
  if (!running) return false; // dev server — nothing hashed to compare
  try {
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const manifest = await res.json();
    const deployed = manifest && manifest.files && manifest.files['main.js'];
    return Boolean(deployed && deployed !== running);
  } catch {
    return false; // offline, or no manifest — leave the app alone
  }
}

// Check on resume, and no more than once a minute so a user flicking between
// apps doesn't fire a request every time.
const MIN_GAP_MS = 60_000;

export function watchForUpdates() {
  let last = 0;
  let busy = false;

  const check = async () => {
    if (busy) return;
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    busy = true;
    try {
      if (await isStale()) {
        // Resume is also when Supabase refreshes an expired session. Refresh
        // tokens are single-use: if we reload mid-refresh, the server has
        // already rotated the token but the new one never reaches storage, and
        // the next launch presents a spent token and gets signed out.
        // getSession() waits on the auth lock, so it resolves only once any
        // in-flight refresh has finished and been persisted.
        try { await supabase.auth.getSession(); } catch { /* reload anyway */ }
        window.location.reload();
      }
    } finally {
      busy = false;
    }
  };

  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  // Back/forward cache restores don't fire visibilitychange on every platform.
  window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
}
