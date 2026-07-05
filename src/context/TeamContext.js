import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchMyTeams } from '../lib/teams';
import { fetchUserPrefs, saveUserPrefs } from '../lib/userPrefs';

const TeamContext = createContext({});
export const useTeam = () => useContext(TeamContext);

const activeKey = (uid) => `tf-active-team-${uid || 'anon'}`;

export function TeamProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id;

  const [teams, setTeams] = useState([]);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshTeams = useCallback(async () => {
    if (!uid) return;
    const list = await fetchMyTeams(uid);
    setTeams(list);
    setActiveTeamId(prev => (prev && list.some(t => t.id === prev)) ? prev : (list[0]?.id || null));
    return list;
  }, [uid]);

  useEffect(() => {
    // Wait for auth's own session restore before deciding anything — on a
    // fresh page load `uid` is briefly `undefined` before it resolves, and
    // treating that the same as "confirmed logged out" (teams=[], loading
    // false) briefly looked like a zero-team account, which could flash
    // RequireTeam into /onboarding for existing users (same bug class as
    // the pet-spin-on-refresh issue — see PetContext.js).
    if (authLoading) return undefined;
    if (!uid) { setTeams([]); setActiveTeamId(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [list, prefs] = await Promise.all([fetchMyTeams(uid), fetchUserPrefs(uid)]);
      if (cancelled) return;
      setTeams(list);
      let remembered = prefs?.active_team_id || null;
      if (!remembered) {
        try { remembered = localStorage.getItem(activeKey(uid)); } catch { /* noop */ }
      }
      const resolved = (remembered && list.some(t => t.id === remembered)) ? remembered : (list[0]?.id || null);
      setActiveTeamId(resolved);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [uid, authLoading]);

  const switchTeam = useCallback((teamId) => {
    setActiveTeamId(teamId);
    try { localStorage.setItem(activeKey(uid), teamId); } catch { /* noop */ }
    saveUserPrefs(uid, { active_team_id: teamId });
  }, [uid]);

  const activeTeam = teams.find(t => t.id === activeTeamId) || null;
  const isOwner = activeTeam?.role === 'owner';
  const isAdmin = activeTeam?.role === 'owner' || activeTeam?.role === 'admin';

  return (
    <TeamContext.Provider value={{
      teams, activeTeam, activeTeamId, loading,
      switchTeam, refreshTeams, isOwner, isAdmin,
    }}>
      {children}
    </TeamContext.Provider>
  );
}
