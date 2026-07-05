// ============================================================
// Server-side per-user preferences (dashboard layout + notif settings)
// Backed by the `user_preferences` table so a user's dashboard is the
// same on every device. localStorage is used elsewhere purely as an
// instant-render cache; this module is the source of truth.
// ============================================================
import { supabase } from './supabase';

export async function fetchUserPrefs(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_preferences')
    .select('dashboard_layout, notif_settings, notif_reads, theme_colors, active_team_id, nav_layout')
    .eq('id', uid)
    .maybeSingle();
  if (error) return null; // table missing / offline — fall back to cache
  return data || null;
}

// Upsert a partial patch (e.g. { dashboard_layout } or { notif_settings }).
// Only the provided columns are written, so layout + settings never clobber
// each other.
export async function saveUserPrefs(uid, patch) {
  if (!uid) return;
  try {
    await supabase
      .from('user_preferences')
      .upsert({ id: uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  } catch { /* non-fatal: the localStorage cache still holds the value */ }
}

// Debounced variant — drag-reorder fires rapidly, so coalesce remote writes.
const timers = {};
export function saveUserPrefsDebounced(uid, patch, delay = 600) {
  if (!uid) return;
  const key = `${uid}:${Object.keys(patch).join(',')}`;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => saveUserPrefs(uid, patch), delay);
}
