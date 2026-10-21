import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { useTheme } from '../context/ThemeContext';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { useNotifications } from '../context/NotificationContext';
import { HeaderActionsProvider } from '../context/HeaderActionsContext';
import { useWaitingOnMeCount } from '../lib/reviews';
import useIsPhone from '../lib/useIsPhone';
import {
  openNewTask, openQuickLog, openQuickContext, openSearch, openNotifications, openNoteScan,
} from '../lib/events';
import { Icon, Avatar, ToastHost, fullName } from '../ui';
import ModalPortal from './ModalPortal';
import ScrollMemory from './ScrollMemory';
import GlobalSearch from './GlobalSearch';
import GlobalShortcuts from './GlobalShortcuts';
import ScanNotifier from './ScanNotifier';
import QuickContext from './QuickContext';
import NotificationCenter from './NotificationCenter';
import NoteScan from './NoteScan';
import TaskContextMenu from './TaskContextMenu';
import TopBar, { TenurePill } from './TopBar';
import ErrorBoundary from './ErrorBoundary';
import { useEscapeStack } from '../ui/Sheet';

// The rail, top to bottom. `phone` = also a tab in the phone tab bar.
const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'home' },
  { to: '/tasks', label: 'Tasks', icon: 'tasks' },
  { to: '/completed', label: 'Completed', icon: 'done' },
  { to: '/review', label: 'Ready for review', icon: 'eye', badge: 'review' },
  { to: '/context', label: 'Context', icon: 'book' },
  { to: '/files', label: 'Files', icon: 'fileCode' },
  { to: '/submissions', label: 'Submissions', icon: 'inbox' },
  { to: '/team-activity', label: 'Team activity', icon: 'activity', adminOnly: true },
];

// Badge counts are computed once, in the shell, and handed down — each count
// hook holds a realtime subscription, so one per nav item would be wasteful.
const BadgeContext = React.createContext({});
const useBadge = (kind) => React.useContext(BadgeContext)[kind] || 0;

function RailItem({ item }) {
  const count = useBadge(item.badge);
  return (
    <NavLink to={item.to} className={({ isActive }) => `rail-item ${isActive ? 'is-on' : ''}`} aria-label={item.label}>
      <Icon name={item.icon} size={18} />
      {count > 0 && <span key={count} className="rail-badge">{count > 9 ? '9+' : count}</span>}
      <span className="rail-tip">{item.label}</span>
    </NavLink>
  );
}

function Rail({ nav }) {
  const navigate = useNavigate();
  return (
    <aside className="rail" aria-label="Primary">
      <button type="button" className="rail-logo" onClick={() => navigate('/dashboard')} aria-label="TaskFlow home">T</button>
      <nav className="rail-nav">
        {nav.map(item => <RailItem key={item.to} item={item} />)}
      </nav>
      <div className="rail-foot">
        <NavLink to="/settings" className={({ isActive }) => `rail-item ${isActive ? 'is-on' : ''}`} aria-label="Settings">
          <Icon name="settings" size={18} />
          <span className="rail-tip">Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}

// ── Phone ────────────────────────────────────────────────────────

function CreateSheet({ onClose }) {
  useEscapeStack(onClose);
  const navigate = useNavigate();
  const go = (fn) => { onClose(); setTimeout(fn, 140); };
  const items = [
    { icon: 'plus', label: 'New task', run: () => openNewTask() },
    { icon: 'done', label: 'Log a completed task', run: openQuickLog },
    { icon: 'camera', label: 'Scan notebook notes', run: openNoteScan },
    { icon: 'book', label: 'Save context', run: openQuickContext },
    { icon: 'eye', label: 'Post for review', run: () => navigate('/review?new=1') },
  ];
  return (
    <ModalPortal onDismiss={onClose}>
      <div className="more-sheet-overlay" onClick={onClose} />
      <div className="more-sheet stagger" role="dialog" aria-label="Create">
        <div className="more-grabber" />
        {items.map(it => (
          <button key={it.label} type="button" className="more-item" onClick={() => go(it.run)}>
            <Icon name={it.icon} size={19} />{it.label}
          </button>
        ))}
      </div>
    </ModalPortal>
  );
}

function MoreSheet({ nav, onClose }) {
  useEscapeStack(onClose);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const { teams, activeTeam, switchTeam } = useTeam();
  const { mode } = useTheme();
  const { setThemeMode } = useThemeCustomization();
  const { unreadCount } = useNotifications();
  const go = (to) => { onClose(); navigate(to); };
  const later = (fn) => { onClose(); setTimeout(fn, 140); };
  const nextMode = { light: 'dark', dark: 'system', system: 'light' }[mode];

  return (
    <ModalPortal onDismiss={onClose}>
      <div className="more-sheet-overlay" onClick={onClose} />
      <div className="more-sheet" role="dialog" aria-label="Menu">
        <div className="more-grabber" />
        <div className="more-head">
          <Avatar person={profile || { email: user?.email }} size={38} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="truncate" style={{ fontWeight: 600 }}>{fullName(profile) || 'You'}</div>
            <div className="truncate t-3" style={{ fontSize: 13 }}>{activeTeam?.name}</div>
          </div>
          <TenurePill />
        </div>
        <div className="stagger">
          {nav.map(item => (
            <button key={item.to} type="button" className={`more-item ${pathname.startsWith(item.to) ? 'is-on' : ''}`} onClick={() => go(item.to)}>
              <Icon name={item.icon} size={19} />{item.label}
            </button>
          ))}
          <button type="button" className={`more-item ${pathname.startsWith('/settings') ? 'is-on' : ''}`} onClick={() => go('/settings')}>
            <Icon name="settings" size={19} />Settings
          </button>
        </div>
        <div className="more-sep" />
        <button type="button" className="more-item" onClick={() => later(openNotifications)}>
          <Icon name="bell" size={19} />Notifications
          {unreadCount > 0 && <span className="rail-badge">{unreadCount}</span>}
        </button>
        <button type="button" className="more-item" onClick={() => later(openSearch)}>
          <Icon name="search" size={19} />Search
        </button>
        <button type="button" className="more-item" onClick={() => setThemeMode(nextMode)}>
          <Icon name={mode === 'dark' ? 'moon' : mode === 'system' ? 'monitor' : 'sun'} size={19} />
          Theme: {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </button>
        {teams.length > 1 && (
          <>
            <div className="more-sep" />
            {teams.map(t => (
              <button key={t.id} type="button" className={`more-item ${t.id === activeTeam?.id ? 'is-on' : ''}`} onClick={() => { switchTeam(t.id); onClose(); }}>
                <Icon name="users" size={19} />{t.name}
                {t.id === activeTeam?.id && <Icon name="check" size={16} style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
          </>
        )}
        <div className="more-sep" />
        <button type="button" className="more-item" style={{ color: 'var(--danger)' }} onClick={async () => { onClose(); await signOut(); navigate('/login'); }}>
          <Icon name="logout" size={19} />Sign out
        </button>
      </div>
    </ModalPortal>
  );
}

function TabBar({ nav }) {
  const [sheet, setSheet] = useState(null); // 'create' | 'more'
  const reviewCount = useBadge('review');
  const tab = (to, label, icon, count) => (
    <NavLink to={to} className={({ isActive }) => `tabbar-item ${isActive ? 'is-on' : ''}`}>
      <Icon name={icon} size={21} />
      {count > 0 && <span key={count} className="rail-badge">{count > 9 ? '9+' : count}</span>}
      {label}
    </NavLink>
  );
  return (
    <>
      <nav className="tabbar" aria-label="Primary">
        {tab('/dashboard', 'Home', 'home')}
        {tab('/tasks', 'Tasks', 'tasks')}
        <button type="button" className="tabbar-item" onClick={() => setSheet('create')} aria-label="Create">
          <span className={`tabbar-add ${sheet === 'create' ? 'is-open' : ''}`}><Icon name="plus" size={20} stroke={2.2} /></span>
        </button>
        {tab('/review', 'Review', 'eye', reviewCount)}
        <button type="button" className="tabbar-item" onClick={() => setSheet('more')}>
          <Icon name="menu" size={21} />More
        </button>
      </nav>
      {sheet === 'create' && <CreateSheet onClose={() => setSheet(null)} />}
      {sheet === 'more' && <MoreSheet nav={nav.filter(n => !['/dashboard', '/tasks', '/review'].includes(n.to))} onClose={() => setSheet(null)} />}
    </>
  );
}

// ── Shell ────────────────────────────────────────────────────────

function PageOutlet() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[1] || 'dashboard';
  return (
    <div key={section} className="app-page page-enter">
      <ErrorBoundary><Outlet /></ErrorBoundary>
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const { isAdmin, activeTeam } = useTeam();
  const reviewCount = useWaitingOnMeCount(activeTeam?.id, user?.id);
  const badges = React.useMemo(() => ({ review: reviewCount }), [reviewCount]);
  const isPhone = useIsPhone();
  const nav = NAV.filter(n => !n.adminOnly || isAdmin);
  const [notifOpen, setNotifOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    const onNotif = () => setNotifOpen(true);
    const onScan = () => setScanOpen(true);
    window.addEventListener('open-notifications', onNotif);
    window.addEventListener('open-note-scan', onScan);
    return () => {
      window.removeEventListener('open-notifications', onNotif);
      window.removeEventListener('open-note-scan', onScan);
    };
  }, []);

  return (
    <BadgeContext.Provider value={badges}>
    <div className="app">
      <Rail nav={nav} />
      <main className="app-main">
        <HeaderActionsProvider>
          <ScrollMemory />
          <TopBar />
          <PageOutlet />
        </HeaderActionsProvider>
      </main>
      {isPhone && <TabBar nav={nav} />}

      <GlobalSearch />
      <GlobalShortcuts />
      <ScanNotifier />
      <QuickContext hideTrigger />
      <TaskContextMenu />
      {notifOpen && <NotificationCenter onClose={() => setNotifOpen(false)} />}
      {scanOpen && <NoteScan onClose={() => setScanOpen(false)} />}
      <ToastHost />
    </div>
    </BadgeContext.Provider>
  );
}
