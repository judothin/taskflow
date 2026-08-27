// ============================================================
// Sidebar nav layout model + registry + persistence
// ------------------------------------------------------------
// A layout is an ordered array of { id, visible }. `id` is a key into
// NAV_ITEMS. Mirrors the dashboard widget layout system (dashboardLayout.js)
// so both customization features behave the same way.
// ============================================================

export const NAV_ITEMS = {
  dashboard: {
    to: '/dashboard', label: 'Dashboard',
    icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
    locked: true, // always visible — it's the app's landing page
  },
  active: {
    to: '/active', label: 'Active Tasks',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 12h6 M9 16h4',
  },
  completed: {
    to: '/completed', label: 'Completed Tasks',
    icon: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
  },
  projects: {
    to: '/projects', label: 'Projects',
    icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
    badge: true,
  },
  files: {
    to: '/files', label: 'Files',
    icon: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
  },
  pomodoro: {
    to: '/pomodoro', label: 'Pomodoro',
    icon: 'M12 8v4l3 2 M12 2a10 10 0 100 20 10 10 0 000-20z M9 2h6',
  },
  submissions: {
    to: '/submissions', label: 'Submissions',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M12 12v4 M10 14h4',
  },
  teams: {
    to: '/teams', label: 'Teams',
    icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 11a4 4 0 100-8 4 4 0 000 8z',
  },
  settings: {
    to: '/settings', label: 'Settings',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
  help: {
    to: '/help', label: 'Help',
    icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3 M12 17h.01',
  },
};

export const DEFAULT_NAV_LAYOUT = Object.keys(NAV_ITEMS).map(id => ({ id, visible: true }));

const KEY = (uid) => `tf-nav-layout-${uid || 'anon'}`;

// Drop unknown ids, dedupe, force locked items visible, and append any item
// missing from a stored layout (e.g. a nav item added after the user last
// saved) at the end so nothing new silently disappears.
export function sanitizeNavLayout(layout) {
  const valid = (Array.isArray(layout) ? layout : [])
    .filter(b => b && NAV_ITEMS[b.id])
    .map(b => ({ id: b.id, visible: b.visible !== false }));

  const seen = new Set();
  const deduped = valid.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));

  Object.keys(NAV_ITEMS).forEach(id => {
    if (!seen.has(id)) { deduped.push({ id, visible: true }); seen.add(id); }
  });

  return deduped.map(b => (NAV_ITEMS[b.id].locked ? { ...b, visible: true } : b));
}

// Synchronous read from the localStorage cache, for instant first paint.
// The DB value (see userPrefs.js) is reconciled in afterwards.
export function loadNavLayoutCache(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return sanitizeNavLayout(raw ? JSON.parse(raw) : DEFAULT_NAV_LAYOUT);
  } catch {
    return sanitizeNavLayout(DEFAULT_NAV_LAYOUT);
  }
}

export function saveNavLayoutCache(uid, layout) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(sanitizeNavLayout(layout))); } catch { /* non-fatal */ }
}
