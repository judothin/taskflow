import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import { useTheme } from '../context/ThemeContext';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { supabase } from '../lib/supabase';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';
import { NAV_ITEMS, sanitizeNavLayout, loadNavLayoutCache, saveNavLayoutCache } from '../lib/navLayout';
import QueuePanel from './QueuePanel';
import Avatar from './Avatar';
import PetSprite from './PetSprite';
import GlobalSearch, { OPEN_EVENT } from './GlobalSearch';
import GlobalShortcuts from './GlobalShortcuts';
import TopBar from './TopBar';
import { HeaderActionsProvider } from '../context/HeaderActionsContext';
import './Layout.css';

const openSearch = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

const NavIcon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

// Short, single-word labels read better under a dock icon ("Active Tasks" → "Active").
const dockLabel = (label) => label.split(' ')[0];

function ProjectsNavBadge({ userId, teamId }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId || !teamId) return;
    const [{ data: projs }, { data: reads }] = await Promise.all([
      supabase.from('projects').select('id, updated_at').eq('team_id', teamId),
      supabase.from('project_reads').select('project_id, last_read_at').eq('user_id', userId),
    ]);
    const readsMap = {};
    (reads || []).forEach(r => { readsMap[r.project_id] = r.last_read_at; });
    const unread = (projs || []).filter(p => {
      const last = readsMap[p.id];
      return !last || new Date(p.updated_at) > new Date(last);
    });
    setCount(unread.length);
  }, [userId, teamId]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('project-read', handler);
    window.addEventListener('project-updated', handler);
    return () => {
      window.removeEventListener('project-read', handler);
      window.removeEventListener('project-updated', handler);
    };
  }, [refresh]);

  if (!count) return null;
  return <span className="nav-unread-badge">{count}</span>;
}

function TeamSwitcher() {
  const { teams, activeTeam, switchTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!activeTeam) return null;

  return (
    <div className="team-switcher" ref={ref}>
      <button className="team-switcher-trigger" onClick={() => setOpen(v => !v)}>
        <span className="team-switcher-name">{activeTeam.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </button>
      {open && (
        <div className="team-switcher-popover">
          {teams.map(t => (
            <button
              key={t.id}
              className={`team-switcher-option ${t.id === activeTeam.id ? 'team-switcher-option-active' : ''}`}
              onClick={() => { switchTeam(t.id); setOpen(false); }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>{t.name}</span>
              {t.id === activeTeam.id && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </button>
          ))}
          <div className="team-switcher-divider" />
          <button className="team-switcher-option team-switcher-manage" onClick={() => { setOpen(false); navigate('/teams'); }}>
            Manage teams
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { profile, user, signOut } = useAuth();
  const uid = user?.id;
  const { activeTeam } = useTeam();
  const { activePet, gamificationEnabled } = usePets();
  const { theme, toggle } = useTheme();
  const { colors } = useThemeCustomization();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Sidebar nav customization (reorder + show/hide, synced to Supabase) ──
  const [navLayout, setNavLayout] = useState(() => loadNavLayoutCache(uid));
  const [navEditing, setNavEditing] = useState(false);
  const [reorderId, setReorderId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, after }

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setNavLayout(loadNavLayoutCache(uid));
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.nav_layout) {
        const remote = sanitizeNavLayout(prefs.nav_layout);
        setNavLayout(remote);
        saveNavLayoutCache(uid, remote);
      } else {
        saveUserPrefs(uid, { nav_layout: loadNavLayoutCache(uid) });
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const persistNav = (next) => {
    const sanitized = sanitizeNavLayout(next);
    setNavLayout(sanitized);
    saveNavLayoutCache(uid, sanitized);
    saveUserPrefsDebounced(uid, { nav_layout: sanitized });
  };

  const toggleNavVisible = (id) => {
    if (NAV_ITEMS[id].locked) return;
    persistNav(navLayout.map(b => (b.id === id ? { ...b, visible: !b.visible } : b)));
  };

  const handleNavDragStart = (e, id) => {
    setReorderId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const handleNavDragOver = (e, id) => {
    if (!reorderId || id === reorderId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropTarget({ id, after: e.clientY > rect.top + rect.height / 2 });
  };
  const handleNavDrop = (e, targetId) => {
    e.preventDefault();
    if (!reorderId || reorderId === targetId) { setReorderId(null); setDropTarget(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = e.clientY > rect.top + rect.height / 2;
    const arr = [...navLayout];
    const fromIdx = arr.findIndex(b => b.id === reorderId);
    const [moved] = arr.splice(fromIdx, 1);
    const toIdx = arr.findIndex(b => b.id === targetId);
    arr.splice(insertAfter ? toIdx + 1 : toIdx, 0, moved);
    persistNav(arr);
    setReorderId(null);
    setDropTarget(null);
  };
  const handleNavDragEnd = () => { setReorderId(null); setDropTarget(null); };

  // Collapsible nav: a small edge tab toggles it; the choice is cached.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tf-nav-collapsed') === '1');
  const toggleCollapsed = () => setCollapsed(c => {
    const next = !c;
    try { localStorage.setItem('tf-nav-collapsed', next ? '1' : '0'); } catch {}
    return next;
  });
  // A custom background/text = the user has set their own theme, so the
  // light/dark toggle no longer applies. Otherwise it works as before.
  const hasCustomTheme = Boolean(colors?.bg || colors?.text);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const initials  = profile ? `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase() : '?';
  const userColor = profile?.color || '#6366f1';

  // The 'pets' nav item is always force-hidden when gamification is off
  // (personally opted out, or the active team has it disabled) — it's
  // filtered out of BOTH the visible list and the customize/edit list, so
  // there's nothing to toggle back on for something the user can't reach
  // anyway (going to /pets directly also redirects away, see Pets.js).
  const effectiveNavLayout = gamificationEnabled ? navLayout : navLayout.filter(b => b.id !== 'pets');
  const visibleNavLayout = effectiveNavLayout.filter(b => b.visible);

  return (
    <div className={`layout ${collapsed ? 'nav-collapsed' : ''}`}>

      <button
        className="nav-toggle-tab"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
        </svg>
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-logo">
          {activePet && gamificationEnabled ? (
            <div className="logo-mark logo-pet-mark">
              <PetSprite
                species={activePet.species}
                style={activePet.style}
                size={36}
                dead={activePet.is_dead}
                idleAnimation={activePet.idle_animation}
                roam={false}
              />
            </div>
          ) : (
            <img src="/logo.png" alt="TaskFlow" className="logo-mark" />
          )}
          <span className="logo-text">TaskFlow</span>
        </div>

        <TeamSwitcher />

        <button className="nav-search-btn" onClick={openSearch} title="Search (press /)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="nav-search-label">Search</span>
          <kbd className="nav-search-kbd">/</kbd>
        </button>

        <nav className="sidebar-nav">
          {!navEditing ? (
            visibleNavLayout.map(({ id }) => {
              const item = NAV_ITEMS[id];
              return (
                <NavLink
                  key={id}
                  to={item.to}
                  className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <NavIcon d={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {item.badge && <ProjectsNavBadge userId={user?.id} teamId={activeTeam?.id} />}
                  <span className="nav-tip" aria-hidden="true">{item.label}</span>
                </NavLink>
              );
            })
          ) : (
            effectiveNavLayout.map(({ id, visible }) => {
              const item = NAV_ITEMS[id];
              const isTarget = dropTarget?.id === id;
              return (
                <div
                  key={id}
                  className={[
                    'nav-edit-row',
                    !visible ? 'nav-edit-row-hidden' : '',
                    reorderId === id ? 'nav-edit-row-dragging' : '',
                    isTarget && !dropTarget.after ? 'nav-edit-row-insert-before' : '',
                    isTarget && dropTarget.after ? 'nav-edit-row-insert-after' : '',
                  ].filter(Boolean).join(' ')}
                  draggable
                  onDragStart={e => handleNavDragStart(e, id)}
                  onDragOver={e => handleNavDragOver(e, id)}
                  onDrop={e => handleNavDrop(e, id)}
                  onDragEnd={handleNavDragEnd}
                >
                  <span className="nav-edit-grip" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                      <circle cx="7" cy="4" r="1.5"/><circle cx="13" cy="4" r="1.5"/>
                      <circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>
                      <circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
                    </svg>
                  </span>
                  <NavIcon d={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {item.locked ? (
                    <span className="nav-edit-locked">Always shown</span>
                  ) : (
                    <button
                      type="button"
                      className="nav-edit-toggle"
                      onClick={() => toggleNavVisible(id)}
                      aria-label={visible ? `Hide ${item.label}` : `Show ${item.label}`}
                      aria-pressed={visible}
                    >
                      {visible ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}

          <button
            type="button"
            className="nav-customize-btn"
            onClick={() => setNavEditing(v => !v)}
          >
            {navEditing ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Done
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9 M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
                Customize
              </>
            )}
          </button>
        </nav>

        <div className="sidebar-queue">
          <QueuePanel />
        </div>

        <div className="sidebar-footer">
          {!hasCustomTheme && (
            <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="theme-icon-sun">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
              <div className="theme-track">
                <div className={`theme-thumb ${theme === 'light' ? 'theme-thumb-light' : ''}`} />
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="theme-icon-moon">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            </button>
          )}

          {activeTeam && (
            <a href={`/submit/${activeTeam.slug}`} target="_blank" rel="noreferrer" className="guest-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6 M15 3h6v6 M10 14L21 3" />
              </svg>
              <span className="guest-link-text">Guest Portal</span>
            </a>
          )}

          <div className="user-info">
            <Avatar src={profile?.avatar_url} color={userColor} initials={initials} size={34} />
            <div className="user-details">
              <span className="user-name">{profile?.first_name} {profile?.last_name}</span>
              <button onClick={handleSignOut} className="sign-out-btn">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="mobile-header">
          <img src="/logo.png" alt="TaskFlow" className="mobile-logo-img" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="mobile-search-btn" onClick={openSearch} aria-label="Search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <Avatar src={profile?.avatar_url} color={userColor} initials={initials} size={32} />
          </div>
        </header>
        <HeaderActionsProvider>
          <TopBar />
          <div className="page-content">
            <Outlet />
          </div>
        </HeaderActionsProvider>
      </main>

      {/* ── Mobile dock (bottom tab bar) — app-style primary nav on phones ── */}
      <nav className="mobile-dock" aria-label="Primary">
        {visibleNavLayout.slice(0, 4).map(({ id }) => {
          const item = NAV_ITEMS[id];
          return (
            <NavLink
              key={id}
              to={item.to}
              className={({ isActive }) => `dock-item ${isActive ? 'dock-item-active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="dock-icon">
                <NavIcon d={item.icon} />
                {item.badge && <ProjectsNavBadge userId={user?.id} teamId={activeTeam?.id} />}
              </span>
              <span className="dock-label">{dockLabel(item.label)}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`dock-item dock-more ${sidebarOpen ? 'dock-item-active' : ''}`}
          onClick={() => setSidebarOpen(v => !v)}
          aria-label="More"
          aria-expanded={sidebarOpen}
        >
          <span className="dock-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </span>
          <span className="dock-label">More</span>
        </button>
      </nav>

      {/* ── Full-screen mobile menu (opened from the dock's "More") ── */}
      {sidebarOpen && (
        <div className="mobile-menu">
          <div className="mobile-menu-head">
            <img src="/logo.png" alt="TaskFlow" className="mobile-menu-logo" />
            <span className="mobile-menu-title">Menu</span>
            <button className="mobile-menu-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="mobile-menu-body">
            <TeamSwitcher />

            <button className="mobile-menu-search" onClick={() => { openSearch(); setSidebarOpen(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search
              <kbd className="mobile-menu-kbd">/</kbd>
            </button>

            <nav className="mobile-menu-nav">
              {visibleNavLayout.map(({ id }) => {
                const item = NAV_ITEMS[id];
                return (
                  <NavLink
                    key={id}
                    to={item.to}
                    className={({ isActive }) => `mobile-menu-item ${isActive ? 'mobile-menu-item-active' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <NavIcon d={item.icon} />
                    <span>{item.label}</span>
                    {item.badge && <ProjectsNavBadge userId={user?.id} teamId={activeTeam?.id} />}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="mobile-menu-footer">
            {!hasCustomTheme && (
              <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="theme-icon-sun">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                <div className="theme-track"><div className={`theme-thumb ${theme === 'light' ? 'theme-thumb-light' : ''}`} /></div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="theme-icon-moon">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
              </button>
            )}

            {activeTeam && (
              <a href={`/submit/${activeTeam.slug}`} target="_blank" rel="noreferrer" className="guest-link" onClick={() => setSidebarOpen(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6 M15 3h6v6 M10 14L21 3" />
                </svg>
                <span className="guest-link-text">Guest Portal</span>
              </a>
            )}

            <div className="user-info">
              <Avatar src={profile?.avatar_url} color={userColor} initials={initials} size={38} />
              <div className="user-details">
                <span className="user-name">{profile?.first_name} {profile?.last_name}</span>
                <button onClick={handleSignOut} className="sign-out-btn">Sign out</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <GlobalSearch />
      <GlobalShortcuts />
    </div>
  );
}
