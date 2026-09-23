// ============================================================
// Dashboard layout model + widget registry + persistence
// ------------------------------------------------------------
// A layout is an ordered array of blocks: { type, size, opts }.
//  - `type` is a key into WIDGETS (one instance per type).
//  - `size` is either a named preset key (see SIZES below) or a plain
//    integer 1-12 grid-column span, from dragging the resize handle.
//  - `opts` holds per-widget display settings, and only the keys the widget
//    actually supports (see sanitizeOpts). An absent key means "auto", which
//    is why nothing is written there by default — a widget left alone keeps
//    deriving its layout from its own width.
// Stats counts (top) and the Calendar (sidebar top) are rendered
// separately and are always present + locked — they are NOT blocks.
// ============================================================

// Grid is 12 columns (see .dash-grid in Dashboard.css) so quarter/third/
// half/two-thirds/three-quarters/full all land on exact whole-column widths.
export const SIZES = [
  { key: 'quarter',    label: '1/4',  span: 3 },
  { key: 'third',      label: '1/3',  span: 4 },
  { key: 'half',       label: '1/2',  span: 6 },
  { key: 'twoThirds',  label: '2/3',  span: 8 },
  { key: 'threeQuarters', label: '3/4', span: 9 },
  { key: 'full',       label: 'Full', span: 12 },
];
const MAX_SPAN = 12;

// Widget metadata. `locked` blocks can be reordered/resized but never removed.
export const WIDGETS = {
  focus: {
    name: 'Current Focus',
    desc: 'In-progress tasks and your up-next queue.',
    icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    defaultSize: 'full',
    cards: true,      // lays out task cards → column count is customizable
    countable: true,  // ...and it shows a capped slice, so the cap is too
  },
  allTasks: {
    name: 'Active Tasks',
    desc: 'The full, filterable list of active tasks.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2',
    defaultSize: 'full',
    cards: true,
  },
  activityChart: {
    name: 'Activity Chart',
    desc: 'Your personal completion heat-map by day.',
    icon: 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3',
    defaultSize: 'half',
  },
  completedToday: {
    name: 'Completed Today',
    desc: 'Everything finished so far today, by whom.',
    icon: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
    defaultSize: 'third',
  },
  stats: {
    name: 'Your Stats',
    desc: 'Your lifetime tasks completed & created.',
    icon: 'M12 20V10 M18 20V4 M6 20v-4',
    defaultSize: 'third',
  },
  badges: {
    name: 'Your Badges',
    desc: 'Every rank & achievement badge you\'ve earned.',
    icon: 'M12 15a7 7 0 100-14 7 7 0 000 14z M8.21 13.89L7 23l5-3 5 3-1.21-9.12',
    defaultSize: 'half',
  },
  notifications: {
    name: 'Notification Center',
    desc: 'Live activity feed with per-type alerts and a settings panel.',
    icon: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0',
    defaultSize: 'half',
  },
  roiBreakdown: {
    name: 'ROI Breakdown',
    desc: 'Active tasks split by ROI priority.',
    icon: 'M21.21 15.89A10 10 0 118 2.83 M22 12A10 10 0 0012 2v10z',
    defaultSize: 'third',
  },
  leaderboard: {
    name: 'Team Leaderboard',
    desc: 'Who completed the most tasks this week.',
    icon: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 01-10 0z M5 9H3a2 2 0 01-2-2V5h4 M19 9h2a2 2 0 002-2V5h-4',
    defaultSize: 'third',
  },
  recentActivity: {
    name: 'Recent Activity',
    desc: 'A running log of newly created & completed tasks.',
    icon: 'M12 8v4l3 3 M3.05 11a9 9 0 116.36 9.95',
    defaultSize: 'half',
  },
  streak: {
    name: 'Completion Streak',
    desc: 'Your consecutive days with a completed task.',
    icon: 'M12 2s7 5 7 11a7 7 0 01-14 0c0-2 1-4 3-5 0 2 1 3 2 3 1.5 0 1-3-1-6 2 0 5 2 6 6',
    defaultSize: 'third',
  },
  projects: {
    name: 'Projects',
    desc: 'Recently updated projects with unread badges.',
    icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
    defaultSize: 'third',
  },
  queue: {
    name: 'Queue',
    desc: 'Reorder or remove up-next tasks — syncs with the focus bar & nav.',
    icon: 'M3 6h18 M3 12h18 M3 18h12',
    defaultSize: 'third',
  },
  pomodoro: {
    name: 'Pomodoro',
    desc: 'A focus timer with custom durations — shared with the Pomodoro page.',
    icon: 'M12 8v4l3 2 M12 2a10 10 0 100 20 10 10 0 000-20z M9 2h6',
    defaultSize: 'third',
  },
};

export const DEFAULT_LAYOUT = [
  { type: 'focus',    size: 'full' },
  { type: 'allTasks', size: 'full' },
  { type: 'pet',       size: 'third' },
];

// ── Per-widget display options ───────────────────────────────
// Task cards get unreadable below roughly a quarter of the grid, so 4 is the
// practical ceiling on columns. The visible-card cap is looser — it scrolls.
export const MAX_COLUMNS = 4;
export const MAX_VISIBLE_CARDS = 12;

export const COLUMN_CHOICES = [
  { value: null, label: 'Auto' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

const clampInt = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(min, Math.min(max, n)));
};

// Only keep options the widget actually understands, so a stored layout can't
// carry settings for a widget that never had them (or no longer does).
function sanitizeOpts(type, opts) {
  const meta = WIDGETS[type] || {};
  const out = {};
  if (!opts || typeof opts !== 'object') return out;
  if (meta.cards) {
    const columns = clampInt(opts.columns, 1, MAX_COLUMNS);
    if (columns) out.columns = columns;
  }
  if (meta.countable) {
    const visible = clampInt(opts.visible, 1, MAX_VISIBLE_CARDS);
    if (visible) out.visible = visible;
  }
  return out;
}

// The column count a widget falls back to when it has no explicit setting:
// derived from its own width, since the grid is 12 columns and a task card
// needs about 4 of them to stay readable. This is the behavior every card
// widget had before columns became customizable.
export function autoColumns(size) {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.round(spanFor(size) / 4)));
}

export function columnsFor(block) {
  return block?.opts?.columns || autoColumns(block?.size);
}

// How many cards a capped widget shows at once. Defaults to one full row.
export function visibleCountFor(block) {
  return block?.opts?.visible || autoColumns(block?.size);
}

const KEY = (uid) => `tf-dashboard-layout-${uid || 'anon'}`;

// `size` is either a named preset key ('quarter'/'third'/'half'/'twoThirds'/
// 'full', from the segmented control) or a plain integer 1-12 (from
// dragging the resize handle directly) — both are valid, `spanFor` below
// resolves either.
function isValidSize(size) {
  if (SIZES.some(s => s.key === size)) return true;
  return typeof size === 'number' && Number.isFinite(size) && size >= 1 && size <= MAX_SPAN;
}

// Drop any block whose type no longer exists, guarantee the locked blocks are
// present, and coerce sizes to known values.
export function sanitizeLayout(layout) {
  const valid = (Array.isArray(layout) ? layout : [])
    .filter(b => b && WIDGETS[b.type])
    .map(b => ({
      type: b.type,
      size: isValidSize(b.size) ? b.size : (WIDGETS[b.type].defaultSize || 'full'),
      opts: sanitizeOpts(b.type, b.opts),
    }));

  // Dedupe (one instance per type), keeping first occurrence.
  const seen = new Set();
  const deduped = valid.filter(b => (seen.has(b.type) ? false : (seen.add(b.type), true)));

  // Ensure locked widgets exist.
  Object.entries(WIDGETS).forEach(([type, meta]) => {
    if (meta.locked && !seen.has(type)) {
      deduped.unshift({ type, size: meta.defaultSize || 'full', opts: {} });
      seen.add(type);
    }
  });

  return deduped;
}

// Top-bar date/time readout preference (replaces the old sidebar calendar).
export const DEFAULT_DISPLAY = { date: true, time: false };

function sanitizeDisplay(d) {
  if (!d || typeof d !== 'object') return { ...DEFAULT_DISPLAY };
  return { date: d.date !== false, time: !!d.time };
}

// A stored prefs payload is { blocks, display }. Older payloads were a bare
// blocks array — normalize both into the object shape.
export function normalizePrefs(raw) {
  if (Array.isArray(raw)) {
    return { blocks: sanitizeLayout(raw), display: { ...DEFAULT_DISPLAY } };
  }
  if (raw && typeof raw === 'object') {
    return { blocks: sanitizeLayout(raw.blocks), display: sanitizeDisplay(raw.display) };
  }
  return { blocks: sanitizeLayout(DEFAULT_LAYOUT), display: { ...DEFAULT_DISPLAY } };
}

// Synchronous read from the localStorage cache, for instant first paint.
// The DB value (see userPrefs.js) is reconciled in afterwards by the page.
export function loadPrefsCache(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return normalizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizePrefs(null);
  }
}

export function savePrefsCache(uid, prefs) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(normalizePrefs(prefs)));
  } catch { /* storage full / unavailable — non-fatal */ }
}

export function spanFor(size) {
  if (typeof size === 'number') return Math.round(Math.max(1, Math.min(MAX_SPAN, size)));
  return (SIZES.find(s => s.key === size) || {}).span ?? MAX_SPAN;
}
