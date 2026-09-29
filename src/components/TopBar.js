import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import { useTopBar } from '../context/TopBarContext';
import { loadShownBadges } from '../lib/badgePrefs';
import { NAV_ITEMS } from '../lib/navLayout';
import { useHeaderActions } from '../context/HeaderActionsContext';
import { useStreak } from '../context/StreakContext';
import { useSpecialBadges } from '../context/SpecialBadgesContext';
import StreakBar from './StreakBar';
import TopBarMenu from './TopBarMenu';
import useIsPhone from '../lib/useIsPhone';
import RankBadges from './PetBadges';
import LevelRing from './LevelRing';
import { DashboardClock } from './dashboardWidgets';
import './TopBar.css';

// Map the first path segment → a page title (from the nav registry, plus a few
// routes that aren't in the sidebar).
const SEGMENT_TITLES = Object.values(NAV_ITEMS).reduce((m, i) => {
  m[i.to.replace(/^\//, '')] = i.label;
  return m;
}, {
  tasks: 'Tasks',
  // Companion routes — not in the nav registry (they're dock-only), so they
  // need their titles spelled out here or they'd render as raw slugs.
  focus: 'Current Focus',
  stats: 'Stats',
  quicklog: 'Quick Log',
});

function routeTitle(pathname) {
  const seg = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return SEGMENT_TITLES[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
}

// The persistent status bar shown at the top of every page: the current page
// breadcrumb on the left, and your rank badges, level bar, and date/time on
// the right. Sticky + frosted.
export default function TopBar() {
  const { user, profile } = useAuth();
  const { userLevel, gamificationEnabled } = usePets();
  const { display } = useTopBar();
  const { pathname } = useLocation();
  const isPhone = useIsPhone();
  const headerActions = useHeaderActions();
  const { days: streakDays, best: streakBest, paused: streakPaused, teamId: streakTeamId } = useStreak();
  const { specialFlags } = useSpecialBadges();
  const [shown, setShown] = useState(null);

  useEffect(() => {
    if (!user?.id) return undefined;
    setShown(loadShownBadges(user.id));
    const h = () => setShown(loadShownBadges(user.id));
    window.addEventListener('badges-changed', h);
    return () => window.removeEventListener('badges-changed', h);
  }, [user?.id]);

  // On a phone the task detail screen carries its own back button, status and
  // title — the breadcrumb above it would be a third stacked header saying
  // less than either.
  if (isPhone && /^\/tasks\/[^/]+$/.test(pathname)) return null;

  return (
    <div className="app-topbar">
      <div className="app-topbar-left">
        <div className="app-topbar-crumb">
          <span className="app-topbar-crumb-root">TaskFlow</span>
          <svg className="app-topbar-crumb-sep" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          {/* Keyed by title so a new page's name animates in (TopBar.css). */}
          <span key={routeTitle(pathname)} className="app-topbar-crumb-current">{routeTitle(pathname)}</span>
        </div>
        {/* After the page name, so the title reads first. On a phone the
            streak is the ring in the app header instead (Layout). */}
        {!isPhone && (
          <StreakBar key={streakTeamId} days={streakDays} best={streakBest} paused={streakPaused} />
        )}
      </div>
      <div className="app-topbar-right">
        {headerActions && <div className="app-topbar-actions">{headerActions}</div>}
        <div className="app-topbar-cluster">
          {gamificationEnabled && (
            <RankBadges
            level={userLevel?.level}
            createdAt={profile?.start_date || user?.created_at}
            tasksDone={userLevel?.tasks_completed}
            specialFlags={specialFlags}
            compact size={46} shown={shown}
          />
          )}
          {/* Phone: the level ring is in the app header, and the phone's own
              status bar already shows the time. */}
          {gamificationEnabled && !isPhone && <LevelRing size={34} />}
          {!isPhone && <DashboardClock showDate={display.date} showTime={display.time} />}
        </div>
        {/* Quick Log, Save context and the page's own extras. The phone has
            the dock for those instead. */}
        {!isPhone && <TopBarMenu />}
      </div>
    </div>
  );
}
