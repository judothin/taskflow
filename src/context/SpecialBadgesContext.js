import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';

// Resolves the activity-based special badges (firefighter / century /
// speed-runner / clean-sweep) from the DB. Once a badge has been earned we
// remember it in localStorage so a momentary one (Clean Sweep) doesn't blink
// off the next time state changes — achievements are permanent.
const SpecialBadgesContext = createContext({});
export const useSpecialBadges = () => useContext(SpecialBadgesContext);

const KEY = (uid) => `tf-special-earned-${uid || 'anon'}`;
const loadEarned = (uid) => { try { return JSON.parse(localStorage.getItem(KEY(uid))) || []; } catch { return []; } };
const saveEarned = (uid, keys) => { try { localStorage.setItem(KEY(uid), JSON.stringify(keys)); } catch { /* noop */ } };

const ym = (iso) => (iso || '').slice(0, 7); // YYYY-MM

export function SpecialBadgesProvider({ children }) {
  const { user, profile } = useAuth();
  const { teams } = useTeam();
  const teamIds = (teams || []).map(t => t.id).join(',');
  const [flags, setFlags] = useState({});

  const compute = useCallback(async () => {
    if (!user?.id) { setFlags({}); return; }
    const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    const live = {};

    try {
      // Firefighter — 25 critical tasks cleared by this user.
      if (fullName) {
        const { count } = await supabase
          .from('tasks').select('id', { count: 'exact', head: true })
          .eq('status', 'completed').eq('roi', 'critical').ilike('completed_by', `%${fullName}%`);
        live.firefighter = (count || 0) >= 25;

        // Century — 100+ completions in a single calendar month.
        const { data: comp } = await supabase
          .from('tasks').select('date_completed')
          .eq('status', 'completed').ilike('completed_by', `%${fullName}%`)
          .not('date_completed', 'is', null).limit(5000);
        const byMonth = {};
        (comp || []).forEach(t => { const k = ym(t.date_completed); byMonth[k] = (byMonth[k] || 0) + 1; });
        live.century = Object.values(byMonth).some(n => n >= 100);
      }

      // Speed Runner — a task the user created and completed within 10 minutes
      // (excludes Quick Log, whose date_completed equals created_at).
      const { data: mine } = await supabase
        .from('tasks').select('created_at, date_completed')
        .eq('created_by', user.id).eq('status', 'completed')
        .not('date_completed', 'is', null).limit(5000);
      live['speed-runner'] = (mine || []).some(t => {
        const a = new Date(t.created_at).getTime();
        const b = new Date(t.date_completed).getTime();
        return b > a && (b - a) <= 10 * 60 * 1000;
      });

      // Clean Sweep — ANY team you're on currently has zero open + in-progress
      // (and at least one task, so an empty team doesn't count).
      const ids = teamIds ? teamIds.split(',') : [];
      if (ids.length) {
        const perTeam = await Promise.all(ids.map(async (id) => {
          const [{ count: openCount }, { count: totalCount }] = await Promise.all([
            supabase.from('tasks').select('id', { count: 'exact', head: true })
              .eq('team_id', id).in('status', ['open', 'in_progress']),
            supabase.from('tasks').select('id', { count: 'exact', head: true })
              .eq('team_id', id),
          ]);
          return (totalCount || 0) > 0 && (openCount || 0) === 0;
        }));
        live['clean-sweep'] = perTeam.some(Boolean);
      }
    } catch { /* best-effort — badges never block anything */ }

    // Merge with anything earned before (achievements are permanent).
    const prev = loadEarned(user.id);
    const merged = new Set(prev);
    Object.entries(live).forEach(([k, v]) => { if (v) merged.add(k); });
    const list = [...merged];
    saveEarned(user.id, list);
    const out = {};
    list.forEach(k => { out[k] = true; });
    setFlags(out);
  }, [user?.id, profile?.first_name, profile?.last_name, teamIds]);

  useEffect(() => { compute(); }, [compute]);
  useEffect(() => {
    const h = () => compute();
    window.addEventListener('tasks-changed', h);
    return () => window.removeEventListener('tasks-changed', h);
  }, [compute]);

  return (
    <SpecialBadgesContext.Provider value={{ specialFlags: flags }}>
      {children}
    </SpecialBadgesContext.Provider>
  );
}
