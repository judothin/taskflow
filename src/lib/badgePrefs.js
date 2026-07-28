// Which earned rank badges the user has chosen to show in the top bar.
// Stored per-user in localStorage; null = never customized (auto: highest
// earned per track). An empty array means the user hid them all.
const KEY = (uid) => `tf-shown-badges-${uid || 'anon'}`;

export function loadShownBadges(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveShownBadges(uid, keys) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(keys)); } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('badges-changed'));
}
