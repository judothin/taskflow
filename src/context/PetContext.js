import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';
import { tickAndSavePet, HUNGER_MAX, WATER_MAX, FEED_AMOUNT, WATER_AMOUNT } from '../lib/petLogic';
// Deliberately no import of the popup components here (PetLevelUpToast /
// PetLevelUpModal / PetSpinModal) — they consume usePets() themselves, and
// importing them from this module would create a circular import. They're
// rendered by PetPopupHost.js instead, mounted once at the app root.

const PetContext = createContext({});
export const usePets = () => useContext(PetContext);

const REFRESH_INTERVAL = 5 * 60 * 1000; // re-tick decay every 5 minutes while open

export function PetProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { activeTeam } = useTeam();
  const uid = user?.id;

  const [userLevel, setUserLevel] = useState(null);
  const [pets, setPets] = useState([]);
  const [customEnvironments, setCustomEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [popupQueue, setPopupQueue] = useState([]);

  const refresh = useCallback(async () => {
    if (!uid) { setUserLevel(null); setPets([]); setCustomEnvironments([]); setLoading(false); return; }
    const [{ data: lvl }, { data: rawPets }, { data: envs }] = await Promise.all([
      supabase.from('user_levels').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('pets').select('*').eq('user_id', uid).order('created_at'),
      supabase.from('pet_environments').select('*').eq('user_id', uid).order('created_at'),
    ]);
    setUserLevel(lvl || null);
    // Personally opting out pauses everything, including pet decay — a
    // user who's turned this off shouldn't come back to a dead pet. The
    // team-level toggle is deliberately NOT checked here: that one only
    // hides UI, it doesn't pause accrual (see gamificationEnabled below).
    const userEnabled = !lvl || lvl.gamification_enabled !== false;
    const ticked = userEnabled
      ? await Promise.all((rawPets || []).map(p => tickAndSavePet(p)))
      : (rawPets || []);
    setPets(ticked);
    setCustomEnvironments(envs || []);
    setLoading(false);
  }, [uid]);

  // Auth's own session restore is itself async — on a fresh page load `uid`
  // is briefly `undefined` before it resolves to the real signed-in user.
  // Without this guard, that transient window looked identical to "no
  // pets yet" (loading=false, pets=[]), which made RequirePet briefly
  // navigate to /pet-reveal for users who already have a pet — the
  // "occasional spin popup on refresh" bug. Waiting for authLoading to
  // settle means `loading` never goes false with stale/empty data.
  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [refresh, authLoading]);

  useEffect(() => {
    if (!uid) return undefined;
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [uid, refresh]);

  // Anything in the app that awards XP (task creation/completion) dispatches
  // this event instead of managing popups itself — one place decides what
  // to show and in what order.
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      refresh();
      const next = [];
      if (d.petLevelUp) next.push({ type: 'petLevelUp', payload: d.petLevelUp });
      if (d.userMilestonesHit > 0) {
        for (let i = 0; i < d.userMilestonesHit; i++) next.push({ type: 'spin' });
      } else if (d.userLevelsGained > 0) {
        next.push({ type: 'toast', payload: { levelsGained: d.userLevelsGained } });
      }
      if (next.length) setPopupQueue(q => [...q, ...next]);
    };
    window.addEventListener('xp-awarded', handler);
    return () => window.removeEventListener('xp-awarded', handler);
  }, [refresh]);

  const dismissPopup = useCallback(() => setPopupQueue(q => q.slice(1)), []);

  // Feeding/watering SPENDS one inventory resource (earned from tasks &
  // leveling) and restores a SET amount (not a full refill), capped at the max.
  // No-op if the cupboard's bare — the UI disables it too.
  const feedPet = useCallback(async (petId) => {
    if (!uid || (userLevel?.food || 0) <= 0) return;
    const pet = pets.find(p => p.id === petId);
    if (!pet) return;
    const newHunger = Math.min(HUNGER_MAX, (Number(pet.hunger) || 0) + FEED_AMOUNT);
    await Promise.all([
      supabase.from('pets').update({ hunger: newHunger }).eq('id', petId),
      supabase.from('user_levels').update({ food: (userLevel.food || 0) - 1 }).eq('user_id', uid),
    ]);
    await refresh();
  }, [uid, userLevel, pets, refresh]);

  const waterPet = useCallback(async (petId) => {
    if (!uid || (userLevel?.water || 0) <= 0) return;
    const pet = pets.find(p => p.id === petId);
    if (!pet) return;
    const newWater = Math.min(WATER_MAX, (Number(pet.water) || 0) + WATER_AMOUNT);
    await Promise.all([
      supabase.from('pets').update({ water: newWater }).eq('id', petId),
      supabase.from('user_levels').update({ water: (userLevel.water || 0) - 1 }).eq('user_id', uid),
    ]);
    await refresh();
  }, [uid, userLevel, pets, refresh]);

  const renamePet = useCallback(async (petId, name) => {
    await supabase.from('pets').update({ name }).eq('id', petId);
    await refresh();
  }, [refresh]);

  const setActivePet = useCallback(async (petId) => {
    const current = pets.find(p => p.is_active);
    if (current && current.id !== petId) {
      await supabase.from('pets').update({ is_active: false }).eq('id', current.id);
    }
    await supabase.from('pets').update({ is_active: true }).eq('id', petId);
    await refresh();
  }, [pets, refresh]);

  const setPetStyle = useCallback(async (petId, style) => {
    await supabase.from('pets').update({ style }).eq('id', petId);
    await refresh();
  }, [refresh]);

  const setPetEnvironment = useCallback(async (petId, environment) => {
    await supabase.from('pets').update({ environment }).eq('id', petId);
    await refresh();
  }, [refresh]);

  const setPetWalkArea = useCallback(async (petId, walkArea) => {
    await supabase.from('pets').update({ walk_area: walkArea }).eq('id', petId);
    await refresh();
  }, [refresh]);

  const setPetIdleAnimation = useCallback(async (petId, idleAnimation) => {
    await supabase.from('pets').update({ idle_animation: idleAnimation }).eq('id', petId);
    await refresh();
  }, [refresh]);

  // Per-pet size multiplier (relative to whatever stage the pet is shown in),
  // driven by the slider on the Pets page and read by both the Pets page and
  // the dashboard widget. Applied to local state immediately so every view
  // (Pets page + widget) resizes live as the slider moves, with the DB write
  // debounced so a drag doesn't fire a request per pixel.
  const sizeSaveTimers = useRef({});
  const setPetSize = useCallback((petId, sizeScale) => {
    setPets(prev => prev.map(p => (p.id === petId ? { ...p, size_scale: sizeScale } : p)));
    clearTimeout(sizeSaveTimers.current[petId]);
    sizeSaveTimers.current[petId] = setTimeout(() => {
      supabase.from('pets').update({ size_scale: sizeScale }).eq('id', petId);
    }, 250);
  }, []);

  // Uploads to the user's personal environment library and returns the
  // public URL; callers then call setPetEnvironment with it if they want to
  // apply it immediately.
  const uploadPetEnvironment = useCallback(async (file) => {
    const ext = file.name.split('.').pop();
    const path = `pet-environments/${uid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('task-images').upload(path, file);
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('task-images').getPublicUrl(path);
    const { error: insErr } = await supabase.from('pet_environments').insert({ user_id: uid, url: data.publicUrl });
    if (insErr) throw insErr;
    await refresh();
    return data.publicUrl;
  }, [uid, refresh]);

  const claimNextPendingUnlock = useCallback(async () => {
    const { data, error } = await supabase.rpc('claim_pet_unlock');
    if (error) throw error;
    await refresh();
    return data;
  }, [refresh]);

  const sacrificeForNewPet = useCallback(async () => {
    const { data, error } = await supabase.rpc('sacrifice_for_new_pet');
    if (error) throw error;
    await refresh();
    return data;
  }, [refresh]);

  // The user's own preference, independent of which team they're currently
  // viewing — used to gate XP accrual/decay itself (see refresh() above),
  // not just visibility.
  const userGamificationEnabled = !userLevel || userLevel.gamification_enabled !== false;
  // Combined visibility flag: hidden if EITHER the user has personally
  // opted out, OR the currently-active team has it turned off for
  // everyone. Unlike userGamificationEnabled, this one does NOT pause
  // accrual — a team-disabled user still earns XP in the background, they
  // just don't see it until they switch to a team where it's shown.
  const gamificationEnabled = userGamificationEnabled && activeTeam?.gamification_enabled !== false;

  // Used both by the initial "do you want pets/XP?" choice screen and by
  // re-toggling later from Settings. Turning it on for someone who has
  // truly never had a pet grants them the same first-spin unlock a normal
  // signup gets; re-enabling after a pause (they already have pets) just
  // resumes as-is.
  const setGamificationEnabled = useCallback(async (enabled) => {
    if (!uid) return;
    const patch = { gamification_enabled: enabled, gamification_choice_made: true };
    // Only grant a fresh unlock if there isn't one already sitting there —
    // a brand new signup's user_levels row is seeded with
    // pending_pet_unlocks: 1 before this choice screen even runs, so
    // unconditionally adding another here would hand new signups two
    // spins instead of one.
    if (enabled && pets.length === 0 && (userLevel?.pending_pet_unlocks || 0) <= 0) {
      patch.pending_pet_unlocks = 1;
    }
    await supabase.from('user_levels').update(patch).eq('user_id', uid);
    await refresh();
  }, [uid, pets.length, userLevel, refresh]);

  const activePet = pets.find(p => p.is_active) || null;
  const pendingUnlocks = userLevel?.pending_pet_unlocks || 0;
  const food = userLevel?.food ?? 0;
  const water = userLevel?.water ?? 0;
  const currentPopup = popupQueue[0] || null;

  return (
    <PetContext.Provider value={{
      userLevel, pets, activePet, pendingUnlocks, loading, customEnvironments,
      food, water,
      gamificationEnabled, userGamificationEnabled, setGamificationEnabled,
      refresh, feedPet, waterPet, renamePet, setActivePet, setPetStyle,
      setPetEnvironment, setPetWalkArea, setPetIdleAnimation, setPetSize, uploadPetEnvironment,
      claimNextPendingUnlock, sacrificeForNewPet,
      currentPopup, dismissPopup,
    }}>
      {children}
    </PetContext.Provider>
  );
}
