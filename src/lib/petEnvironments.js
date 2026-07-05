// ============================================================
// Pet stage backgrounds. Built-ins are auto-discovered from every .webp
// file dropped into src/enviorments/ — webpack's require.context watches
// that folder, so adding, renaming, or removing a file there is picked up
// automatically on the next save/build. No code changes needed to add a
// new built-in environment: just drop in a new .webp file (the filename,
// minus the extension, becomes both its key and its label).
//
// A user's own uploads are stored as full Supabase storage URLs in the
// pet_environments table and referenced the same way via environmentUrl.
// ============================================================

// `false` = don't recurse into subfolders; only match .webp files.
const context = require.context('../enviorments', false, /\.webp$/);

function labelFor(key) {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// key -> the actual (webpack-hashed) built asset URL.
const ENV_URLS = {};

export const BUILTIN_ENVIRONMENTS = context.keys()
  .map((path) => {
    const key = path.replace('./', '').replace(/\.webp$/, '');
    ENV_URLS[key] = context(path);
    return { key, label: labelFor(key) };
  })
  // Keep "default" first if present; otherwise alphabetical by label.
  .sort((a, b) => {
    if (a.key === 'default') return -1;
    if (b.key === 'default') return 1;
    return a.label.localeCompare(b.label);
  });

export const DEFAULT_ENVIRONMENT = ENV_URLS.default ? 'default' : (BUILTIN_ENVIRONMENTS[0]?.key || 'default');

// `env` is either a built-in key (auto-discovered above) or a full URL
// (custom upload).
export function environmentUrl(env) {
  const value = env || DEFAULT_ENVIRONMENT;
  if (value.startsWith('http') || value.startsWith('/')) return value;
  return ENV_URLS[value] || ENV_URLS[DEFAULT_ENVIRONMENT] || value;
}
