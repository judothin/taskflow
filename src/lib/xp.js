// ============================================================
// XP / leveling rules. All numbers here are tunable game-balance defaults,
// not hard requirements — change freely.
// ============================================================
import { supabase } from './supabase';
import { maxHealthForLevel, unlockedStylesForLevel } from './petLogic';

export const TASK_CREATE_XP = 5;
export const TASK_COMPLETE_XP = { low: 10, medium: 20, high: 35 };

// ── Pet resources (food / water) ─────────────────────────────
// Earned by creating & completing tasks and leveling up; spent to feed/water
// a pet. Tunable game-balance defaults.
export const TASK_CREATE_RESOURCES = { food: 1, water: 1 };
export const TASK_COMPLETE_RESOURCES = {
  low:    { food: 1, water: 1 },
  medium: { food: 2, water: 2 },
  high:   { food: 3, water: 3 },
};
export const LEVELUP_RESOURCES = { food: 3, water: 3 }; // per user level gained

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
export function petXpToNext(level) {
  return 40 + (level - 1) * 10;
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

export function applyPetXp(current, gain) {
  const result = applyLevelLoop(current, gain, petXpToNext);
  const stylesBefore = unlockedStylesForLevel(current.level);
  const stylesAfter = unlockedStylesForLevel(result.level);
  return {
    ...result,
    healthGained: result.levelsGained, // +1 max health per level
    styleUnlocked: stylesAfter > stylesBefore,
  };
}

async function fetchUserLevels(userId) {
  const { data } = await supabase.from('user_levels').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function fetchActivePet(userId) {
  const { data } = await supabase.from('pets').select('*')
    .eq('user_id', userId).eq('is_active', true).eq('is_dead', false).maybeSingle();
  return data;
}

function notify(detail) {
  window.dispatchEvent(new CustomEvent('xp-awarded', { detail }));
}

// A task was created (any status). Flat XP to the user only.
export async function awardTaskCreatedXp(userId) {
  if (!userId) return null;
  const row = await fetchUserLevels(userId);
  // Personally opting out of gamification pauses accrual entirely — not
  // just hiding it (that's the separate per-team display toggle, checked
  // in the UI layer, not here).
  if (!row || row.gamification_enabled === false) return null;

  const result = applyUserXp({ level: row.level, xp: row.xp }, TASK_CREATE_XP);
  const pending_pet_unlocks = row.pending_pet_unlocks + result.milestonesHit;
  const foodGained  = TASK_CREATE_RESOURCES.food  + result.levelsGained * LEVELUP_RESOURCES.food;
  const waterGained = TASK_CREATE_RESOURCES.water + result.levelsGained * LEVELUP_RESOURCES.water;
  await supabase.from('user_levels').update({
    level: result.level, xp: result.xp, pending_pet_unlocks,
    food: (row.food || 0) + foodGained, water: (row.water || 0) + waterGained,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  const detail = {
    userXpGained: TASK_CREATE_XP, petXpGained: 0,
    userLevelsGained: result.levelsGained, userMilestonesHit: result.milestonesHit, petLevelUp: null,
    resourcesGained: { food: foodGained, water: waterGained },
  };
  notify(detail);
  return detail;
}

// A task transitioned to completed. XP to the user AND to their active,
// living pet (if any). Base XP scales with complexity; `opts` unlocks bonus
// XP sources: { roi, status, wasQueued }.
//   • critical      — the task was critical priority (roi or status)
//   • queue         — it was an in-progress / focus-queue task
//   • first of day  — your first completed task today
//   • streak        — × consecutive days you've completed something
export async function awardTaskCompletedXp(userId, complexity, opts = {}) {
  if (!userId) return null;
  const base = TASK_COMPLETE_XP[complexity] ?? TASK_COMPLETE_XP.medium;

  const userRow = await fetchUserLevels(userId);
  if (userRow && userRow.gamification_enabled === false) return null;

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

  let newStreak = userRow?.streak || 0;
  let newLastDate = userRow?.last_completed_date || null;
  const firstOfDay = userRow && userRow.last_completed_date !== today;
  if (firstOfDay) {
    bonusXp += BONUS_XP.firstOfDay; bonuses.push({ type: 'firstOfDay', label: 'First task of the day', xp: BONUS_XP.firstOfDay });
    newStreak = userRow.last_completed_date === localYesterday() ? (userRow.streak || 0) + 1 : 1;
    const streakXp = Math.min(BONUS_XP.streakMax, newStreak * BONUS_XP.streakPerDay);
    bonusXp += streakXp; bonuses.push({ type: 'streak', label: `${newStreak}-day streak`, xp: streakXp });
    newLastDate = today;
  }

  const gain = base + bonusXp;

  let userResult = null;
  let resourcesGained = { food: 0, water: 0 };
  if (userRow) {
    userResult = applyUserXp({ level: userRow.level, xp: userRow.xp }, gain);
    const pending_pet_unlocks = userRow.pending_pet_unlocks + userResult.milestonesHit;
    const rc = TASK_COMPLETE_RESOURCES[complexity] ?? TASK_COMPLETE_RESOURCES.medium;
    resourcesGained = {
      food:  rc.food  + userResult.levelsGained * LEVELUP_RESOURCES.food,
      water: rc.water + userResult.levelsGained * LEVELUP_RESOURCES.water,
    };
    await supabase.from('user_levels').update({
      level: userResult.level, xp: userResult.xp, pending_pet_unlocks,
      food: (userRow.food || 0) + resourcesGained.food, water: (userRow.water || 0) + resourcesGained.water,
      last_completed_date: newLastDate, streak: newStreak,
      tasks_completed: (userRow.tasks_completed || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
  }

  const pet = await fetchActivePet(userId);
  let petLevelUp = null;
  if (pet) {
    const r = applyPetXp({ level: pet.level, xp: pet.xp }, gain);
    const newMaxHealth = maxHealthForLevel(r.level);
    const newHealth = Math.min(newMaxHealth, pet.health + r.healthGained);
    await supabase.from('pets').update({ level: r.level, xp: r.xp, health: newHealth }).eq('id', pet.id);
    if (r.levelsGained > 0) {
      petLevelUp = {
        petId: pet.id, petName: pet.name, petSpecies: pet.species, petStyle: pet.style,
        levelsGained: r.levelsGained, newLevel: r.level, healthGained: r.healthGained,
        newHealth, newMaxHealth, styleUnlocked: r.styleUnlocked,
      };
    }
  }

  const detail = {
    userXpGained: gain,
    petXpGained: pet ? gain : 0,
    userLevelsGained: userResult?.levelsGained || 0,
    userMilestonesHit: userResult?.milestonesHit || 0,
    petLevelUp,
    resourcesGained,
    bonuses,
  };
  notify(detail);
  return detail;
}
