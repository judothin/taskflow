// ============================================================
// New UI presets
// ------------------------------------------------------------
// The new UI swaps free-form colour pickers for a handful of curated
// themes. Each preset is a light and a dark palette; the palettes
// themselves live in src/modern/tokens.css (keyed by data-preset), and
// the values here are only for drawing the preview tiles in Settings and
// for the pre-paint background in public/index.html — keep the `bg`
// values in step with tokens.css.
// ============================================================

export const UI_PRESETS = [
  {
    id: 'slate', label: 'Slate',
    light: { bg: '#f7f7f8', surface: '#ffffff', sidebar: '#f1f1f3', border: '#e5e5e9', text: '#18181b', accent: '#4f5bd5' },
    dark:  { bg: '#111113', surface: '#18181b', sidebar: '#141416', border: '#26262b', text: '#ececef', accent: '#7b86f0' },
  },
  {
    id: 'ocean', label: 'Ocean',
    light: { bg: '#f5f8fb', surface: '#ffffff', sidebar: '#edf2f7', border: '#e0e7ee', text: '#0f1a24', accent: '#0a74b8' },
    dark:  { bg: '#0d141b', surface: '#131c25', sidebar: '#0f171f', border: '#1f2b37', text: '#e6edf3', accent: '#3ea4e6' },
  },
  {
    id: 'forest', label: 'Forest',
    light: { bg: '#f6f8f6', surface: '#ffffff', sidebar: '#eef3ef', border: '#e0e7e1', text: '#142018', accent: '#1d8048' },
    dark:  { bg: '#0e1411', surface: '#141b17', sidebar: '#101713', border: '#202b25', text: '#e5ede8', accent: '#3fbf75' },
  },
  {
    id: 'rose', label: 'Rose',
    light: { bg: '#faf7f8', surface: '#ffffff', sidebar: '#f5eef1', border: '#ece2e5', text: '#22161a', accent: '#cc2f66' },
    dark:  { bg: '#151012', surface: '#1c1518', sidebar: '#181214', border: '#2c2226', text: '#f1e8eb', accent: '#ef6491' },
  },
  {
    id: 'sand', label: 'Sand',
    light: { bg: '#f9f7f3', surface: '#fffdf9', sidebar: '#f3efe7', border: '#e9e3d8', text: '#241f17', accent: '#b9520f' },
    dark:  { bg: '#14120e', surface: '#1b1814', sidebar: '#171511', border: '#2b261f', text: '#f0ebe2', accent: '#e98a42' },
  },
  {
    id: 'violet', label: 'Violet',
    light: { bg: '#f8f7fb', surface: '#ffffff', sidebar: '#f1eff8', border: '#e6e2ef', text: '#1b1726', accent: '#6a47dc' },
    dark:  { bg: '#121019', surface: '#18151f', sidebar: '#14121b', border: '#27222f', text: '#ece9f3', accent: '#9c7ef6' },
  },
];

export const DEFAULT_UI_PRESET = 'slate';

export function resolvePreset(id) {
  return UI_PRESETS.find(p => p.id === id) || UI_PRESETS[0];
}
