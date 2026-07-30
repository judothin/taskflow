import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';
import { fetchStreak, STREAK_CHANGED } from '../lib/streak';

// Current user's streak for the active team, kept fresh across task actions
// and team switches.
const StreakContext = createContext({ days: 0, paused: false });
export const useStreak = () => useContext(StreakContext);

export function StreakProvider({ children }) {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const [row, setRow] = useState(null);

  const refresh = useCallback(async () => {
    if (!user?.id || !activeTeamId) { setRow(null); return; }
    setRow(await fetchStreak(activeTeamId, user.id));
  }, [user?.id, activeTeamId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener(STREAK_CHANGED, h);
    return () => window.removeEventListener(STREAK_CHANGED, h);
  }, [refresh]);

  return (
    <StreakContext.Provider value={{
      days: row?.current_streak || 0,
      best: row?.best_streak || 0,
      paused: !!row?.paused,
      teamId: activeTeamId,
      refresh,
    }}>
      {children}
    </StreakContext.Provider>
  );
}
