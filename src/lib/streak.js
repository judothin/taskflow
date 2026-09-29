import { supabase } from './supabase';

// ============================================================
// Per-team activity streaks — tiers, assets, and RPC wrappers.
// A streak counts consecutive days you created OR completed a task.
// ============================================================

export const STREAK_CHANGED = 'streak-changed';

// Highest threshold first — streakTier() returns the first match.
// `c1` → `c2` is the streak bar's gradient while you're working back up to
// your best (components/StreakBar.js). On a record run the bar takes a new
// colour each day instead, so these only apply below your best.
export const STREAK_TIERS = [
  { min: 21, key: 'aurora', label: 'Aurora', c1: '#a855f7', c2: '#2dd4bf' },
  { min: 11, key: 'teal',   label: 'Teal',   c1: '#14b8a6', c2: '#5eead4' },
  { min: 7,  key: 'blaze',  label: 'Blaze',  c1: '#ef4444', c2: '#fb923c' },
  { min: 4,  key: 'silver', label: 'Silver', c1: '#9aa4b2', c2: '#eef1f5' },
  { min: 1,  key: 'bronze', label: 'Bronze', c1: '#a0612b', c2: '#e3a36a' },
];

export function streakTier(days) {
  if (!days || days < 1) return null;
  return STREAK_TIERS.find(t => days >= t.min) || null;
}

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
