// ============================================================
// XP / leveling rules. All numbers here are tunable game-balance defaults,
// not hard requirements — change freely.
// ============================================================
import { supabase } from './supabase';

export const TASK_CREATE_XP = 5;
export const TASK_COMPLETE_XP = { low: 10, medium: 20, high: 35 };

// ── Bonus XP sources (on top of the base completion XP) ──────
export const BONUS_XP = {
  critical:     15,  // completing a critical-priority task
  queue:        10,  // completing a task from the focus queue (in progress)
  firstOfDay:   15,  // your first completed task of the day
  streakPerDay:  5,  // × current streak length…
  streakMax:    60,  // …capped here
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localToday = () => ymd(new Date());
const localYesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); };

export function userXpToNext(level) {
  return 100 + (level - 1) * 20;
}

function applyLevelLoop({ level, xp }, gain, xpToNextFn) {
  let lvl = level;
  let x = xp + gain;
  let levelsGained = 0;
  while (x >= xpToNextFn(lvl)) {
    x -= xpToNextFn(lvl);
    lvl += 1;
    levelsGained += 1;
  }
  return { level: lvl, xp: x, levelsGained };
}

export function applyUserXp(current, gain) {
  const result = applyLevelLoop(current, gain, userXpToNext);
  let milestonesHit = 0;
  for (let l = current.level + 1; l <= result.level; l++) {
    if (l % 5 === 0) milestonesHit += 1;
  }
  return { ...result, milestonesHit };
}

async function fetchUserLevels(userId) {
  const { data } = await supabase.from('user_levels').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

function notify(detail) {
  window.dispatchEvent(new CustomEvent('xp-awarded', { detail }));
}

// A task was created (any status). Flat XP to the user.
export async function awardTaskCreatedXp(userId) {
  if (!userId) return null;
  const row = await fetchUserLevels(userId);
  if (!row || row.gamification_enabled === false) return null;

  const result = applyUserXp({ level: row.level, xp: row.xp }, TASK_CREATE_XP);
  await supabase.from('user_levels').update({
    level: result.level, xp: result.xp,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  const detail = {
    userXpGained: TASK_CREATE_XP,
    userLevelsGained: result.levelsGained, userMilestonesHit: result.milestonesHit,
  };
  notify(detail);
  return detail;
}

// A task transitioned to completed. Base XP scales with complexity; `opts`
// unlocks bonus XP sources: { roi, status, wasQueued }.
export async function awardTaskCompletedXp(userId, complexity, opts = {}) {
  if (!userId) return null;
  const base = TASK_COMPLETE_XP[complexity] ?? TASK_COMPLETE_XP.medium;

  const userRow = await fetchUserLevels(userId);
  if (!userRow || userRow.gamification_enabled === false) return null;

  // ── Bonus XP ──
  const today = localToday();
  const bonuses = [];
  let bonusXp = 0;

  if (opts.roi === 'critical' || opts.status === 'critical') {
    bonusXp += BONUS_XP.critical; bonuses.push({ type: 'critical', label: 'Critical cleared', xp: BONUS_XP.critical });
  }
  if (opts.wasQueued) {
    bonusXp += BONUS_XP.queue; bonuses.push({ type: 'queue', label: 'Queue completion', xp: BONUS_XP.queue });
  }

  let newStreak = userRow.streak || 0;
  let newLastDate = userRow.last_completed_date || null;
  const firstOfDay = userRow.last_completed_date !== today;
  if (firstOfDay) {
    bonusXp += BONUS_XP.firstOfDay; bonuses.push({ type: 'firstOfDay', label: 'First task of the day', xp: BONUS_XP.firstOfDay });
    newStreak = userRow.last_completed_date === localYesterday() ? (userRow.streak || 0) + 1 : 1;
    const streakXp = Math.min(BONUS_XP.streakMax, newStreak * BONUS_XP.streakPerDay);
    bonusXp += streakXp; bonuses.push({ type: 'streak', label: `${newStreak}-day streak`, xp: streakXp });
    newLastDate = today;
  }

  const gain = base + bonusXp;
  const userResult = applyUserXp({ level: userRow.level, xp: userRow.xp }, gain);
  await supabase.from('user_levels').update({
    level: userResult.level, xp: userResult.xp,
    last_completed_date: newLastDate, streak: newStreak,
    tasks_completed: (userRow.tasks_completed || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  const detail = {
    userXpGained: gain,
    userLevelsGained: userResult.levelsGained,
    userMilestonesHit: userResult.milestonesHit,
    bonuses,
  };
  notify(detail);
  return detail;
}
