import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';

// Levels / XP context. (Pets were removed; the hook name is kept so existing
// consumers don't churn.) Provides the user's level row plus the gamification
// visibility flags used to hide levels/XP/badges per user or per team.
const PetContext = createContext({});
export const usePets = () => useContext(PetContext);

export function PetProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { activeTeam } = useTeam();
  const uid = user?.id;

  const [userLevel, setUserLevel] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!uid) { setUserLevel(null); setLoading(false); return; }
    const { data } = await supabase.from('user_levels').select('*').eq('user_id', uid).maybeSingle();
    setUserLevel(data || null);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [refresh, authLoading]);

  // Keep level/xp/tasks fresh after any XP award (badges + stats read these).
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('xp-awarded', handler);
    return () => window.removeEventListener('xp-awarded', handler);
  }, [refresh]);

  const userGamificationEnabled = !userLevel || userLevel.gamification_enabled !== false;
  const gamificationEnabled = userGamificationEnabled && activeTeam?.gamification_enabled !== false;

  const setGamificationEnabled = useCallback(async (enabled) => {
    if (!uid) return;
    await supabase.from('user_levels').update({
      gamification_enabled: enabled, gamification_choice_made: true,
    }).eq('user_id', uid);
    await refresh();
  }, [uid, refresh]);

  return (
    <PetContext.Provider value={{
      userLevel, loading, refresh,
      gamificationEnabled, userGamificationEnabled, setGamificationEnabled,
    }}>
      {children}
    </PetContext.Provider>
  );
}
