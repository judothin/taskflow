import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import { useTopBar } from '../context/TopBarContext';
import { loadShownBadges } from '../lib/badgePrefs';
import { NAV_ITEMS } from '../lib/navLayout';
import { SPECIES_KEYS } from '../lib/petSpecies';
import { useHeaderActions } from '../context/HeaderActionsContext';
import { useStreak } from '../context/StreakContext';
import { useSpecialBadges } from '../context/SpecialBadgesContext';
import StreakFlame from './StreakFlame';
import RankBadges from './PetBadges';
import UserXpBar from './UserXpBar';
import { DashboardClock } from './dashboardWidgets';
import './TopBar.css';

// Map the first path segment → a page title (from the nav registry, plus a few
// routes that aren't in the sidebar).
const SEGMENT_TITLES = Object.values(NAV_ITEMS).reduce((m, i) => {
  m[i.to.replace(/^\//, '')] = i.label;
  return m;
}, { tasks: 'Tasks' });

function routeTitle(pathname) {
  const seg = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return SEGMENT_TITLES[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
}

// The persistent status bar shown at the top of every page: the current page
// breadcrumb on the left, and your rank badges, level bar, and date/time on
// the right. Sticky + frosted.
export default function TopBar() {
  const { user, profile } = useAuth();
  const { userLevel, gamificationEnabled, pets } = usePets();
  const { display } = useTopBar();
  const { pathname } = useLocation();
  const headerActions = useHeaderActions();
  const { days: streakDays, paused: streakPaused, teamId: streakTeamId } = useStreak();
  const { specialFlags } = useSpecialBadges();
  const [shown, setShown] = useState(null);

  useEffect(() => {
    if (!user?.id) return undefined;
    setShown(loadShownBadges(user.id));
    const h = () => setShown(loadShownBadges(user.id));
    window.addEventListener('badges-changed', h);
    return () => window.removeEventListener('badges-changed', h);
  }, [user?.id]);

  return (
    <div className="app-topbar">
      <div className="app-topbar-left">
        <StreakFlame days={streakDays} paused={streakPaused} teamId={streakTeamId} size={46} />
        <div className="app-topbar-crumb">
          <span className="app-topbar-crumb-root">TaskFlow</span>
          <svg className="app-topbar-crumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          <span className="app-topbar-crumb-current">{routeTitle(pathname)}</span>
        </div>
      </div>
      <div className="app-topbar-right">
        {headerActions && <div className="app-topbar-actions">{headerActions}</div>}
        <div className="app-topbar-cluster">
          {gamificationEnabled && (
            <RankBadges
            level={userLevel?.level}
            createdAt={profile?.start_date || user?.created_at}
            tasksDone={userLevel?.tasks_completed}
            speciesOwned={new Set((pets || []).map(p => p.species)).size}
            speciesTotal={SPECIES_KEYS.length}
            specialFlags={specialFlags}
            compact size={46} shown={shown}
          />
          )}
          {gamificationEnabled && <UserXpBar />}
          <DashboardClock showDate={display.date} showTime={display.time} />
        </div>
      </div>
    </div>
  );
}
