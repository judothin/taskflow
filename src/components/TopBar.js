import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format, differenceInDays, differenceInMonths } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import { useTheme } from '../context/ThemeContext';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { useHeaderActions } from '../context/HeaderActionsContext';
import { useNotifications } from '../context/NotificationContext';
import { userXpToNext } from '../lib/xp';
import { openSearch, openNotifications } from '../lib/events';
import { Icon, Avatar, Menu, MenuItem, MenuSep, MenuLabel, useMenu, fullName } from '../ui';

// First path segment → the page name in the breadcrumb.
const TITLES = {
  dashboard: 'Dashboard', tasks: 'Tasks', completed: 'Completed', review: 'Ready for review',
  context: 'Context', files: 'Files', 'team-activity': 'Team activity', submissions: 'Submissions', 'go-live': 'Ready for live',
  settings: 'Settings',
};
export const routeTitle = (pathname) => {
  const seg = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return TITLES[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
};

/** "6 mo" — how long you've been on TaskFlow (profile start date, else signup). */
export function tenureLabel(since) {
  if (!since) return null;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.max(0, differenceInDays(new Date(), d));
  if (days < 30) return `${days} d`;
  const months = differenceInMonths(new Date(), d);
  if (months < 12) return `${months} mo`;
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${yrs} yr ${rem} mo` : `${yrs} yr`;
}

/** Level pill: a ring that fills toward the next level, "Lv 45". */
export function LevelPill() {
  const { userLevel, gamificationEnabled } = usePets();
  const [pulse, setPulse] = useState(0);
  const [gain, setGain] = useState(null);

  useEffect(() => {
    const on = (e) => {
      const n = e.detail?.userXpGained;
      if (!n) return;
      setPulse(p => p + 1);
      setGain({ n, k: Date.now() });
    };
    window.addEventListener('xp-awarded', on);
    return () => window.removeEventListener('xp-awarded', on);
  }, []);

  if (!gamificationEnabled) return null;
  const level = userLevel?.level || 1;
  const xp = userLevel?.xp || 0;
  const next = userXpToNext(level);
  const pct = Math.max(0, Math.min(1, xp / Math.max(1, next)));
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span
      key={pulse}
      className={`pill pill-level ${pulse ? 'is-pulsing' : ''}`}
      style={{ position: 'relative' }}
      title={`Level ${level} · ${Math.round(xp)}/${next} XP to level ${level + 1}`}
    >
      <svg className="ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="ring-track" cx="9" cy="9" r={r} strokeWidth="2.2" />
        <circle
          className="ring-fill" cx="9" cy="9" r={r} strokeWidth="2.2"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 9 9)"
        />
      </svg>
      Lv {level}
      {gain && <span key={gain.k} className="xp-float" onAnimationEnd={() => setGain(null)}>+{gain.n} XP</span>}
    </span>
  );
}

export function TenurePill() {
  const { user, profile } = useAuth();
  const label = tenureLabel(profile?.start_date || user?.created_at);
  if (!label) return null;
  return (
    <span className="pill pill-mono" title="Time on TaskFlow">
      <Icon name="clock" size={13} />{label}
    </span>
  );
}

export function AccountMenu() {
  const { user, profile, signOut } = useAuth();
  const { teams, activeTeam, switchTeam } = useTeam();
  const { mode } = useTheme();
  const { setThemeMode } = useThemeCustomization();
  const navigate = useNavigate();
  const menu = useMenu();
  const me = profile || { email: user?.email };

  return (
    <>
      <button ref={menu.anchorRef} type="button" className="me-btn" onClick={menu.toggle} aria-label="Account menu" aria-expanded={menu.open}>
        <Avatar person={me} size={32} />
      </button>
      <Menu {...menu.props} align="end" width={264}>
        <div className="menu-head">
          <Avatar person={me} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{fullName(profile) || 'You'}</div>
            <div className="truncate t-3" style={{ fontSize: 12.5 }}>{user?.email}</div>
          </div>
        </div>
        <MenuSep />
        {teams.length > 0 && <MenuLabel>Team</MenuLabel>}
        {teams.map(t => (
          <MenuItem key={t.id} icon="users" checked={t.id === activeTeam?.id} onClick={() => switchTeam(t.id)}>{t.name}</MenuItem>
        ))}
        <MenuSep />
        <MenuLabel>Theme</MenuLabel>
        <MenuItem icon="sun" checked={mode === 'light'} onClick={() => setThemeMode('light')} keepOpen>Light</MenuItem>
        <MenuItem icon="moon" checked={mode === 'dark'} onClick={() => setThemeMode('dark')} keepOpen>Dark</MenuItem>
        <MenuItem icon="monitor" checked={mode === 'system'} onClick={() => setThemeMode('system')} keepOpen>System</MenuItem>
        <MenuSep />
        <MenuItem icon="search" kbd="/" onClick={openSearch}>Search</MenuItem>
        <MenuItem icon="settings" onClick={() => navigate('/settings')}>Settings</MenuItem>
        {activeTeam?.slug && (
          <MenuItem icon="external" onClick={() => window.open(`/submit/${activeTeam.slug}`, '_blank', 'noopener')}>Guest portal</MenuItem>
        )}
        <MenuSep />
        <MenuItem icon="logout" danger onClick={async () => { await signOut(); navigate('/login'); }}>Sign out</MenuItem>
      </Menu>
    </>
  );
}

function NotifButton() {
  const { unreadCount } = useNotifications();
  return (
    <button type="button" className="topbar-icon" onClick={openNotifications} aria-label="Notifications" title="Notifications">
      <Icon name="bell" size={17} />
      {unreadCount > 0 && <span key={unreadCount} className="rail-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
  );
}

// The bar across the top of every page: where you are, the page's own
// actions, then your level, tenure, notifications and account.
export default function TopBar() {
  const { pathname } = useLocation();
  const actions = useHeaderActions();
  const title = routeTitle(pathname);
  return (
    <header className="topbar">
      <span className="mobile-logo" aria-hidden="true">T</span>
      <div className="crumb">
        <span className="crumb-root">TaskFlow</span>
        <span className="crumb-sep">/</span>
        <span key={title} className="crumb-page">{title}</span>
      </div>
      <div className="topbar-right">
        <span className="topbar-date">{format(new Date(), 'EEE d MMM')}</span>
        {actions && <div className="topbar-actions">{actions}</div>}
        <span className="topbar-sep" />
        <LevelPill />
        <span className="hide-phone"><TenurePill /></span>
        <button type="button" className="topbar-icon hide-phone" onClick={openSearch} aria-label="Search" title="Search (/)">
          <Icon name="search" size={17} />
        </button>
        <NotifButton />
        <AccountMenu />
      </div>
    </header>
  );
}
