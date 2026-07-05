// ============================================================
// Theme customization — applies user-chosen colors as CSS variable
// overrides on :root. A few base colors drive many derived shades
// (elevated surfaces, muted text, hover/glow) via simple blending,
// so the whole app stays coherent from a handful of pickers.
// ============================================================

// Base colors shown as pickers in Settings (each drives derived shades).
export const THEME_FIELDS = [
  { key: 'bg',     label: 'Background', desc: 'Page background & card surfaces', varRef: '--bg' },
  { key: 'accent', label: 'Secondary',  desc: 'Buttons, links, highlights & the activity chart', varRef: '--accent' },
  { key: 'border', label: 'Borders',    desc: 'Card, input & divider borders', varRef: '--border' },
  { key: 'text',   label: 'Text',       desc: 'Primary font color', varRef: '--text' },
];

export const STATUS_FIELDS = [
  { key: 'critical',    label: 'Critical',    varRef: '--st-critical' },
  { key: 'open',        label: 'Open',        varRef: '--st-open' },
  { key: 'in_progress', label: 'In Progress', varRef: '--st-inprogress' },
  { key: 'on_hold',     label: 'On Hold',     varRef: '--st-onhold' },
  { key: 'completed',   label: 'Completed',   varRef: '--st-completed' },
];

// Every CSS var this module may set — cleared before each apply so that
// removing a customization reverts to the active theme's default.
const MANAGED_VARS = [
  '--bg', '--bg-2', '--bg-3', '--bg-4',
  '--text', '--text-muted', '--text-dim',
  '--border', '--border-light',
  '--accent', '--accent-hover', '--accent-glow',
  '--st-critical', '--st-open', '--st-inprogress', '--st-onhold', '--st-completed',
  '--logo-filter', '--glass-blur', '--bg-solid',
];

// ── Color math ───────────────────────────────────────────────
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function parseHex(h) {
  let s = (h || '').trim().replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');

function mix(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return a;
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

function rgba(a, alpha) {
  const A = parseHex(a);
  return A ? `rgba(${A.r}, ${A.g}, ${A.b}, ${alpha})` : a;
}

function isLight(hex) {
  const c = parseHex(hex);
  if (!c) return false;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 140;
}

// ── Background-image cache (the ACTIVE background, as a data URI) ─────
// Lets the applied background survive going offline OR being deleted from the
// DB. If the cache is cleared, the theme falls back to a solid colour.
const BG_CACHE_KEY = 'tf-bg-active';
export function loadBgCache() {
  try { return JSON.parse(localStorage.getItem(BG_CACHE_KEY)); } catch { return null; }
}
export function saveBgCache(url, data) {
  try { localStorage.setItem(BG_CACHE_KEY, JSON.stringify({ url, data })); } catch {}
}
export async function cacheBackgroundImage(url) {
  if (!url) return;
  const existing = loadBgCache();
  if (existing && existing.url === url) return; // already cached
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.size > 3_000_000) return; // too large to keep in localStorage
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    saveBgCache(url, data);
  } catch { /* CORS/network — fall back to the URL */ }
}

// A dedicated fixed-position layer for the background image, created lazily.
// Cached background images are stored as base64 data URIs, which can run to
// several MB of text — far past what CSS custom properties can reliably
// round-trip (confirmed: a ~2MB value silently failed to persist via
// `--tf-bg-image`, while the same value set directly as `style.backgroundImage`
// on a real element works fine, same as this app's original approach before
// that indirection was introduced). Using a dedicated fixed element (rather
// than `body { background-attachment: fixed }`) is what avoids the Chromium
// scroll-tearing bug — see the comment on `#tf-bg-layer` in index.css.
function getBgLayer() {
  let el = document.getElementById('tf-bg-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tf-bg-layer';
    el.setAttribute('aria-hidden', 'true');
    document.body.prepend(el);
  }
  return el;
}

// ── Apply / clear ────────────────────────────────────────────
// `clearBackground` defaults to true for the public API (sign-out, etc. want
// a full nuke). applyThemeColors() below calls this with `false` — it used
// to always wipe the bg layer here and unconditionally rewrite it further
// down, which meant EVERY color tweak (even one unrelated to the background,
// like the accent picker) re-decoded and re-blurred a multi-MB background
// image. Native `<input type="color">` popups fire an `input` event on every
// pointer move while dragging, so that turned into dozens of full-viewport
// blurred-image repaints per second — enough to hang the tab solid.
export function clearThemeColors(clearBackground = true) {
  const r = document.documentElement;
  MANAGED_VARS.forEach(v => r.style.removeProperty(v));
  r.style.removeProperty('zoom');
  r.classList.remove('a11y-bold');
  document.body.classList.remove('has-bg-image');
  if (clearBackground) {
    const layer = document.getElementById('tf-bg-layer');
    if (layer) layer.style.backgroundImage = '';
  }
}

// Text-size options for the accessibility control (zoom scales the whole UI).
export const FONT_SCALES = [
  { key: 0.9,  label: 'Small' },
  { key: 1,    label: 'Default' },
  { key: 1.1,  label: 'Large' },
  { key: 1.25, label: 'Extra Large' },
];

export function applyThemeColors(colors) {
  const root = document.documentElement;
  clearThemeColors(false); // start clean so removed keys revert to theme defaults; leave the background layer alone here — handled below, only touched if it actually changed
  const c = colors || {};
  const cs = getComputedStyle(root);
  const cur = (v, fb) => (cs.getPropertyValue(v).trim() || fb);

  if (parseHex(c.bg)) {
    root.style.setProperty('--bg', c.bg);
    root.style.setProperty('--bg-2', mix(c.bg, '#ffffff', 0.045));
    root.style.setProperty('--bg-3', mix(c.bg, '#ffffff', 0.09));
    root.style.setProperty('--bg-4', mix(c.bg, '#ffffff', 0.14));
  }
  if (parseHex(c.text)) {
    // Muted/dim shades are just fainter versions of the text colour — derived
    // from text ALONE so changing the background never shifts the text colours.
    root.style.setProperty('--text', c.text);
    root.style.setProperty('--text-muted', rgba(c.text, 0.62));
    root.style.setProperty('--text-dim', rgba(c.text, 0.42));
  }
  if (parseHex(c.border)) {
    // border-light derives from the border itself (not text), so it's independent.
    root.style.setProperty('--border', c.border);
    root.style.setProperty('--border-light', mix(c.border, isLight(c.border) ? '#000000' : '#ffffff', 0.18));
  }
  if (parseHex(c.accent)) {
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-hover', mix(c.accent, '#000000', 0.14));
    root.style.setProperty('--accent-glow', rgba(c.accent, 0.15));
  }
  STATUS_FIELDS.forEach(f => { if (parseHex(c[f.key])) root.style.setProperty(f.varRef, c[f.key]); });

  // Logo tint: the logo is an image, so we just flip it black/white via a filter.
  if (c.logo === 'white') root.style.setProperty('--logo-filter', 'none');
  else if (c.logo === 'black') root.style.setProperty('--logo-filter', 'invert(1)');
  // 'auto' / unset → leave the theme default (--logo-filter from :root / [data-theme]).

  // Accessibility: text size (whole-UI zoom) + bolder body text.
  const scale = Number(c.fontScale) || 1;
  if (scale !== 1) root.style.setProperty('zoom', String(scale));
  if (c.bold) root.classList.add('a11y-bold');

  // Background image: layer it on the body. Surfaces become translucent so the
  // image shows through (frosted glass — the blur is applied in CSS via
  // `body.has-bg-image`). The glass tint + the solid fallback behind the image
  // derive from the BACKGROUND colour (not text) so they stay independent.
  if (c.background) {
    const baseBg = parseHex(c.bg) ? c.bg : cur('--bg', '#0a0a0f');
    const op = Math.min(Math.max(Number(c.glassOpacity) || 0.55, 0.1), 0.98);
    root.style.setProperty('--bg', baseBg);
    root.style.setProperty('--bg-2', rgba(baseBg, op));
    root.style.setProperty('--bg-3', rgba(baseBg, Math.min(op + 0.13, 1)));
    root.style.setProperty('--bg-4', rgba(baseBg, Math.min(op + 0.25, 1)));
    // Opaque elevated surface for modals (which sit over a dark overlay, so
    // they must stay solid — glass would let the dimmed page bleed through).
    root.style.setProperty('--bg-solid', mix(baseBg, isLight(baseBg) ? '#000000' : '#ffffff', 0.05));
    const line = isLight(baseBg) ? '0, 0, 0' : '255, 255, 255';
    root.style.setProperty('--border', `rgba(${line}, 0.14)`);
    root.style.setProperty('--border-light', `rgba(${line}, 0.24)`);
    const blur = c.glassBlur == null ? 14 : Number(c.glassBlur);
    root.style.setProperty('--glass-blur', `${blur}px`);
    const cached = loadBgCache();
    const src = cached && cached.url === c.background ? cached.data : c.background;
    // Set directly on a real fixed-position element (see getBgLayer above) —
    // not through a CSS custom property (silently fails past a few hundred
    // KB) and not through body's own background (which is what causes
    // scroll tearing when combined with `background-attachment: fixed`).
    // Only actually write it if it changed — `src` can be a multi-MB base64
    // data URI, and this element has a blur filter, so re-assigning the same
    // value forces an expensive full-viewport re-blur for nothing. Every
    // color-picker drag calls applyThemeColors() on each `input` event, so
    // without this guard an unrelated color change (e.g. the accent picker)
    // would re-blur the background dozens of times a second.
    const bgLayer = getBgLayer();
    const nextBgUrl = `url("${src}")`;
    if (bgLayer.style.backgroundImage !== nextBgUrl) bgLayer.style.backgroundImage = nextBgUrl;
    document.body.classList.add('has-bg-image');
  } else {
    const layer = document.getElementById('tf-bg-layer');
    if (layer) layer.style.backgroundImage = '';
  }
}

// The value to seed a picker with: the user's override, else the live
// computed value of the mapped variable (the active theme's default).
export function effectiveColor(key, colors) {
  if (colors && colors[key]) return colors[key];
  const field = [...THEME_FIELDS, ...STATUS_FIELDS].find(f => f.key === key);
  if (!field) return '#000000';
  const val = getComputedStyle(document.documentElement).getPropertyValue(field.varRef).trim();
  return parseHex(val) ? toHex(parseHex(val)) : (val || '#000000');
}

// ── Cache ────────────────────────────────────────────────────
const KEY = (uid) => `tf-theme-colors-${uid || 'anon'}`;

export function loadThemeCache(uid) {
  try { const raw = localStorage.getItem(KEY(uid)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

export function saveThemeCache(uid, colors) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(colors || {})); } catch {}
}
