import { supabase } from './supabase';

// ============================================================
// Per-team activity streaks — tiers, assets, and RPC wrappers.
// A streak counts consecutive days you created OR completed a task.
// ============================================================

export const STREAK_CHANGED = 'streak-changed';

// Highest threshold first — streakTier() returns the first match.
// `color` tints the day count; `glow` is the pulsing halo behind the flame.
// `countTop` = where the day number sits vertically on that flame (% from the
// top). Flames get taller/differently-shaped per tier, so the readable "body"
// spot moves — tuned per asset rather than a single centered value.
export const STREAK_TIERS = [
  { min: 22, key: 'pearl',         color: '#e9edf5', glow: '#a855f7', glow2: '#60a5fa', label: 'Pearl', countTop: 66 },
  { min: 16, key: 'greentopurple', color: '#c084fc', glow: '#a855f7', label: 'Ascendant', countTop: 64 },
  { min: 11, key: 'blue',          color: '#60a5fa', glow: '#3b82f6', label: 'Sapphire',  countTop: 63 },
  { min: 6,  key: 'red',           color: '#f87171', glow: '#ef4444', label: 'Crimson',   countTop: 62 },
  { min: 4,  key: 'orange',        color: '#fb923c', glow: '#f97316', label: 'Amber',     countTop: 60 },
  { min: 1,  key: 'yellow',        color: '#fde047', glow: '#facc15', label: 'Kindling',  countTop: 58 },
];

export function streakTier(days) {
  if (!days || days < 1) return null;
  return STREAK_TIERS.find(t => days >= t.min) || null;
}

export const streakImg = (key) => `/streak-flames/${key}f-Photoroom.png`;

// Caller's LOCAL date as YYYY-MM-DD, so day boundaries match what they see.
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Record activity for today toward this team's streak (create OR complete).
// No-op if already counted today (handled server-side). Fire-and-forget.
export async function bumpTeamStreak(teamId) {
  if (!teamId) return;
  try {
    await supabase.rpc('bump_streak', { p_team_id: teamId, p_today: localToday() });
    window.dispatchEvent(new CustomEvent(STREAK_CHANGED));
  } catch { /* streaks are best-effort — never block the task action */ }
}

export async function fetchStreak(teamId, userId) {
  if (!teamId || !userId) return null;
  const { data } = await supabase
    .from('team_streaks')
    .select('current_streak, best_streak, paused, last_active_date')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  return data || null;
}

export async function fetchTeamStreaks(teamId) {
  if (!teamId) return {};
  const { data } = await supabase
    .from('team_streaks')
    .select('user_id, current_streak, best_streak, paused')
    .eq('team_id', teamId);
  const map = {};
  (data || []).forEach(r => { map[r.user_id] = r; });
  return map;
}

export async function setWeekendStreaks(teamId, enabled) {
  const { error } = await supabase.rpc('set_team_weekend_streaks', { p_team_id: teamId, p_enabled: enabled });
  if (error) throw error;
}

export async function adminSetStreak(teamId, userId, streak) {
  const { error } = await supabase.rpc('admin_set_streak', { p_team_id: teamId, p_user_id: userId, p_streak: streak });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(STREAK_CHANGED));
}

export async function adminSetStreakPaused(teamId, userId, paused) {
  const { error } = await supabase.rpc('admin_set_streak_paused', { p_team_id: teamId, p_user_id: userId, p_paused: paused });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(STREAK_CHANGED));
}
