// ============================================================
// XP / leveling rules. All numbers here are tunable game-balance defaults,
// not hard requirements — change freely.
// ============================================================
import { supabase } from './supabase';
import { maxHealthForLevel, unlockedStylesForLevel } from './petLogic';

export const TASK_CREATE_XP = 5;
export const TASK_COMPLETE_XP = { low: 10, medium: 20, high: 35 };

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
  await supabase.from('user_levels').update({
    level: result.level, xp: result.xp, pending_pet_unlocks, updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  const detail = {
    userXpGained: TASK_CREATE_XP, petXpGained: 0,
    userLevelsGained: result.levelsGained, userMilestonesHit: result.milestonesHit, petLevelUp: null,
  };
  notify(detail);
  return detail;
}

// A task transitioned to completed. XP to the user AND to their active,
// living pet (if any), based on complexity.
export async function awardTaskCompletedXp(userId, complexity) {
  if (!userId) return null;
  const gain = TASK_COMPLETE_XP[complexity] ?? TASK_COMPLETE_XP.medium;

  const userRow = await fetchUserLevels(userId);
  if (userRow && userRow.gamification_enabled === false) return null;
  let userResult = null;
  if (userRow) {
    userResult = applyUserXp({ level: userRow.level, xp: userRow.xp }, gain);
    const pending_pet_unlocks = userRow.pending_pet_unlocks + userResult.milestonesHit;
    await supabase.from('user_levels').update({
      level: userResult.level, xp: userResult.xp, pending_pet_unlocks, updated_at: new Date().toISOString(),
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
  };
  notify(detail);
  return detail;
}
