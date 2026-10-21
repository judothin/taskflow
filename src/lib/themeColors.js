// ============================================================
// Appearance — what a person can change about the look
// ------------------------------------------------------------
// There is one design (src/styles/). On top of it each person picks:
//   mode           'light' | 'dark' | 'system'   (default light)
//   accent         a hex colour, or unset for ink (black / white)
//   background     an image URL, shown behind frosted-glass surfaces
//   glassOpacity   0.1–0.98  how solid the surfaces over the image are
//   glassBlur      px        blur on the image
//   bgTint         hex       a colour wash over the image…
//   bgTintOpacity  0–0.9     …and how strong it is
//   fontScale      whole-UI zoom (accessibility)
//   bold           heavier body text (accessibility)
//   subtaskColumns 1 | 2     checklist columns on task cards
// All of it is stored in user_preferences.theme_colors and cached in
// localStorage so the first paint is already right.
// ============================================================

export const ACCENTS = [
  { label: 'Ink', value: '' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Pink', value: '#db2777' },
  { label: 'Violet', value: '#7c3aed' },
];

export const DEFAULT_BG_TINT = '#000000';
export const MAX_BG_TINT_OPACITY = 0.9;

export const FONT_SCALES = [
  { key: 0.9, label: 'Small' },
  { key: 1, label: 'Default' },
  { key: 1.1, label: 'Large' },
  { key: 1.25, label: 'Extra large' },
];

const MANAGED_VARS = ['--accent', '--accent-text', '--glass-blur', '--glass-alpha', '--bg-tint', '--st-card-min'];

// ── Colour math ──
function parseHex(h) {
  let s = (h || '').trim().replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const isHex = (h) => !!parseHex(h);
function rgba(hex, a) {
  const c = parseHex(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : hex;
}
/** Readable text on top of a colour. */
export function contrastText(hex) {
  const c = parseHex(hex);
  if (!c) return '#ffffff';
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  return lum > 168 ? '#141414' : '#ffffff';
}

// ── Background image cache (the active image as a data URI) ──
const BG_CACHE_KEY = 'tf-bg-active';
export function loadBgCache() {
  try { return JSON.parse(localStorage.getItem(BG_CACHE_KEY)); } catch { return null; }
}
export function clearBgCache(url) {
  try {
    const c = loadBgCache();
    if (!url || (c && c.url === url)) localStorage.removeItem(BG_CACHE_KEY);
  } catch { /* ignore */ }
}
export async function cacheBackgroundImage(url) {
  if (!url) return;
  const existing = loadBgCache();
  if (existing && existing.url === url) return;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.size > 3_000_000) return;
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    localStorage.setItem(BG_CACHE_KEY, JSON.stringify({ url, data }));
  } catch { /* CORS / quota — the URL still works */ }
}

function bgLayer() {
  let el = document.getElementById('tf-bg-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tf-bg-layer';
    el.setAttribute('aria-hidden', 'true');
    document.body.prepend(el);
  }
  return el;
}

// ── Apply / clear ──
export function clearThemeColors(clearBackground = true) {
  const r = document.documentElement;
  MANAGED_VARS.forEach(v => r.style.removeProperty(v));
  r.style.removeProperty('zoom');
  r.style.removeProperty('background-color');
  r.classList.remove('a11y-bold');
  document.body.classList.remove('has-bg-image');
  if (clearBackground) {
    const layer = document.getElementById('tf-bg-layer');
    if (layer) layer.style.backgroundImage = '';
  }
}

export function applyThemeColors(colors) {
  const root = document.documentElement;
  clearThemeColors(false);
  const c = colors || {};

  const scale = Number(c.fontScale) || 1;
  if (scale !== 1) root.style.setProperty('zoom', String(scale));
  if (c.bold) root.classList.add('a11y-bold');
  if (Number(c.subtaskColumns) === 2) root.style.setProperty('--st-card-min', '190px');

  if (parseHex(c.accent)) {
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-text', contrastText(c.accent));
  }

  if (c.background) {
    const op = Math.min(Math.max(Number(c.glassOpacity) || 0.72, 0.1), 0.98);
    root.style.setProperty('--glass-alpha', String(op));
    const blur = c.glassBlur == null ? 14 : Number(c.glassBlur);
    root.style.setProperty('--glass-blur', `${blur}px`);
    const tintOp = Math.min(Math.max(Number(c.bgTintOpacity) || 0, 0), MAX_BG_TINT_OPACITY);
    const tintHex = parseHex(c.bgTint) ? c.bgTint : DEFAULT_BG_TINT;
    if (tintOp > 0) root.style.setProperty('--bg-tint', rgba(tintHex, tintOp));
    const cached = loadBgCache();
    const src = cached && cached.url === c.background ? cached.data : c.background;
    const layer = bgLayer();
    const next = `url("${src}")`;
    if (layer.style.backgroundImage !== next) layer.style.backgroundImage = next;
    document.body.classList.add('has-bg-image');
  } else {
    const layer = document.getElementById('tf-bg-layer');
    if (layer) layer.style.backgroundImage = '';
  }
}

// ── Cache ──
const KEY = (uid) => `tf-theme-colors-${uid || 'anon'}`;
export function loadThemeCache(uid) {
  try { const raw = localStorage.getItem(KEY(uid)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
export function saveThemeCache(uid, colors) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(colors || {})); } catch { /* ignore */ }
}

/** Paint the cached look before React renders, so reloads don't flash. */
export function applyCachedThemeEarly() {
  try {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('tf-theme-colors-') === 0) {
        const c = JSON.parse(localStorage.getItem(k) || '{}');
        if (c && Object.keys(c).length) {
          best = c;
          if (!k.endsWith('-anon')) break;
        }
      }
    }
    if (best) applyThemeColors(best);
  } catch { /* fall back to the defaults */ }
}
