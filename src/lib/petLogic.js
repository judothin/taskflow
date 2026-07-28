// ============================================================
// Pet stat math: health-per-level, style unlocks, and the hunger/water/
// health decay ("tick"), computed lazily on the client since there's no
// server cron / Edge Functions in this project — same philosophy as the
// rest of the app's Supabase usage.
// ============================================================
import { supabase } from './supabase';

export const HUNGER_MAX = 100;
export const WATER_MAX = 100;
// How much one food / water item restores (capped at the max, not a full refill).
export const FEED_AMOUNT = 25;
export const WATER_AMOUNT = 25;
// Full to empty over 24 hours.
export const DRAIN_PER_HOUR = HUNGER_MAX / 24;

export function maxHealthForLevel(level) {
  return level + 2; // level 1 -> 3, matches spec
}

// Fallback wander box (fractions of the stage) when a pet has no custom
// walk_area set yet — a wide, shallow band roughly matching where "the
// floor" tends to sit in most of the built-in environment art (lower-middle
// of the frame), rather than spanning almost the whole image, which let
// the pet wander up into walls/furniture in some scenes.
export const DEFAULT_WALK_AREA = { x: 0.05, y: 0.62, w: 0.9, h: 0.3 };

// Strict validity check for a saved walk area — guards against stale/corrupt
// data (e.g. a box saved before a stage-sizing fix, when the reference frame
// was much smaller, or a divide-by-zero from measuring a not-yet-laid-out
// container) ever being trusted, by either the sprite or the editor.
export function isValidWalkArea(b) {
  return !!b
    && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)
    && b.w >= 0.15 && b.w <= 1 && b.h >= 0.15 && b.h <= 1
    && b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1;
}

// Style 1 from birth, style 2 at pet level 10, style 3 at pet level 20.
export function unlockedStylesForLevel(level) {
  return Math.min(3, 1 + Math.floor(level / 10));
}

// Counts only Monday–Friday time (local) in [start, end) — pets don't decay on
// weekends, so hours that fall on Saturday/Sunday contribute nothing to drain.
// Walks day-by-day across local midnights so any-length interval is handled.
export function weekdayHoursBetween(start, end) {
  const endMs = end.getTime();
  if (endMs <= start.getTime()) return 0;
  let total = 0;
  let cursor = new Date(start.getTime());
  while (cursor.getTime() < endMs) {
    const nextMidnight = new Date(cursor.getTime());
    nextMidnight.setHours(24, 0, 0, 0); // start of the next local day
    const segEnd = Math.min(nextMidnight.getTime(), endMs);
    const day = cursor.getDay(); // 0 = Sun … 6 = Sat
    if (day !== 0 && day !== 6) total += (segEnd - cursor.getTime()) / 36e5;
    cursor = new Date(segEnd);
  }
  return total;
}

// Pure function — given a pet row and "now", compute the decayed state.
// Returns null if no time has meaningfully elapsed. Caller persists it.
// Only weekday hours count toward decay (weekends are a freebie), so a pet
// left on Friday evening is exactly as full on Monday morning.
export function tickPetState(pet, now = new Date()) {
  if (pet.is_dead) return null;
  const elapsedHours = weekdayHoursBetween(new Date(pet.last_tick_at), now);
  if (elapsedHours <= 0.001) return null;

  const hoursUntilHungerEmpty = pet.hunger / DRAIN_PER_HOUR;
  const hoursUntilWaterEmpty  = pet.water  / DRAIN_PER_HOUR;
  const hoursUntilEitherEmpty = Math.min(hoursUntilHungerEmpty, hoursUntilWaterEmpty);

  const newHunger = Math.max(0, pet.hunger - DRAIN_PER_HOUR * elapsedHours);
  const newWater  = Math.max(0, pet.water  - DRAIN_PER_HOUR * elapsedHours);

  let newHealth = pet.health;
  if (elapsedHours > hoursUntilEitherEmpty) {
    const healthLossHours = Math.floor(elapsedHours - hoursUntilEitherEmpty);
    if (healthLossHours > 0) newHealth = Math.max(0, pet.health - healthLossHours);
  }

  const isDead = newHealth <= 0;

  return {
    hunger: newHunger,
    water: newWater,
    health: isDead ? 0 : newHealth,
    is_dead: isDead,
    // A dead pet must never keep is_active=true — otherwise the partial
    // unique index (one active pet per user) would block granting a fresh
    // active pet later (e.g. via sacrifice) while this corpse still holds it.
    ...(isDead && pet.is_active ? { is_active: false } : {}),
    last_tick_at: now.toISOString(),
  };
}

// Applies tickPetState and persists if anything changed; returns the
// (possibly unchanged) pet row either way.
export async function tickAndSavePet(pet) {
  const next = tickPetState(pet);
  if (!next) return pet;
  const { data, error } = await supabase.from('pets').update(next).eq('id', pet.id).select().single();
  return error ? { ...pet, ...next } : data;
}

export function hasLivingPet(pets) {
  return (pets || []).some(p => !p.is_dead);
}

export function sacrificeEligible(pets) {
  return !hasLivingPet(pets);
}
