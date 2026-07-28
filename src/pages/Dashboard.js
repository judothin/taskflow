import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import { fetchTeamMembers } from '../lib/teams';
import { useTopBar } from '../context/TopBarContext';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import QuickLogModal from './QuickLog';
import ProjectsWidget from '../components/ProjectsWidget';
import NotificationCenter from '../components/NotificationCenter';
import QueueWidget from '../components/QueueWidget';
import PomodoroWidget from '../components/PomodoroWidget';
import PetWidget from '../components/PetWidget';
import ActiveTasksList from '../components/ActiveTasksList';
import BulkActionBar from '../components/BulkActionBar';
import useBulkSelect from '../lib/useBulkSelect';
import ModalPortal from '../components/ModalPortal';
import { TopBarPortal } from '../context/HeaderActionsContext';
import {
  ActivityChartWidget, CompletedTodayWidget, RoiBreakdownWidget,
  LeaderboardWidget, RecentActivityWidget, StreakWidget,
} from '../components/dashboardWidgets';
import {
  WIDGETS, SIZES, DEFAULT_LAYOUT, loadPrefsCache, savePrefsCache, normalizePrefs, sanitizeLayout, spanFor,
} from '../lib/dashboardLayout';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';
import '../components/TaskCard.css';
import '../components/ActivityChart.css';
import './Dashboard.css';

const STATUS_FILTERS = [
  { key: 'critical',    label: 'Critical',    color: 'var(--st-critical)' },
  { key: 'open',        label: 'Open',        color: 'var(--st-open)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--st-inprogress)' },
  { key: 'on_hold',     label: 'On Hold',     color: 'var(--st-onhold)' },
  { key: 'completed',   label: 'Completed',   color: 'var(--st-completed)' },
];

// Widgets that render their own outer container (no shared card chrome).
const SELF_CONTAINED = new Set(['focus', 'allTasks', 'projects']);

// Cache the last-known status counts so the locked top bar shows real numbers
// immediately on mount/refresh instead of flashing 0 while tasks load.
const STAT_CACHE_KEY = 'tf-stat-counts';
const loadStatCache = () => {
  try { return JSON.parse(localStorage.getItem(STAT_CACHE_KEY)) || {}; } catch { return {}; }
};

// Cache the last-known Current Focus list (per team) so it renders with real
// content the instant the dashboard mounts — no empty flash or skeleton on
// reload. Reconciled by the live fetch immediately afterwards.
const FOCUS_CACHE_KEY = 'tf-focus-cache';
const loadFocusCache = (teamId) => {
  try {
    const c = JSON.parse(localStorage.getItem(FOCUS_CACHE_KEY));
    if (c && c.teamId === teamId && Array.isArray(c.tasks)) return c.tasks;
  } catch { /* ignore */ }
  return [];
};

export default function Dashboard() {
  const { profile, user } = useAuth();
  const { activeTeamId } = useTeam();
  const { gamificationEnabled } = usePets();
  const uid = user?.id;
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [focusCache, setFocusCache] = useState(() => loadFocusCache(activeTeamId));
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statCache, setStatCache] = useState(loadStatCache);
  const [editTask, setEditTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickLog, setShowQuickLog] = useState(false);
  const focusSelect = useBulkSelect();

  // ── Dashboard layout / edit mode ──────────────────────────
  const [layout, setLayout]   = useState(() => loadPrefsCache(uid).blocks);
  const { display, setDisplayPref } = useTopBar(); // date/time shown app-wide via Layout
  const [editing, setEditing] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [draggingType, setDraggingType] = useState(null);
  const [resizingType, setResizingType] = useState(null);
  const gridRef = useRef(null);

  // Reconcile the layout with the server so it's identical across devices.
  // The localStorage cache gives an instant first paint; the DB is the
  // source of truth and is applied as soon as it loads. (The date/time
  // display pref is reconciled separately by TopBarContext.)
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setLayout(loadPrefsCache(uid).blocks);
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.dashboard_layout) {
        const remote = normalizePrefs(prefs.dashboard_layout);
        setLayout(remote.blocks);
        savePrefsCache(uid, remote);
      } else {
        // No server prefs yet — seed from this device (migrates a local layout up).
        saveUserPrefs(uid, { dashboard_layout: loadPrefsCache(uid) });
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Persist the full prefs payload (blocks + current display) to cache + server.
  const savePrefs = (blocks) => {
    const prefs = { blocks: sanitizeLayout(blocks), display };
    savePrefsCache(uid, prefs);                                    // instant local cache
    saveUserPrefsDebounced(uid, { dashboard_layout: prefs });      // sync to server
  };

  const persist = (updater) => {
    setLayout(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      savePrefs(next);
      return next;
    });
  };

  const toggleDisplay = (key) => setDisplayPref(prev => ({ ...prev, [key]: !prev[key] }));

  const changeSize = (type, size) => persist(prev => prev.map(b => b.type === type ? { ...b, size } : b));
  const removeBlock = (type) => persist(prev => prev.filter(b => b.type !== type));
  const addBlock = (type) => persist(prev =>
    prev.some(b => b.type === type) ? prev : [...prev, { type, size: WIDGETS[type].defaultSize || 'full' }]);
  const resetLayout = () => persist(DEFAULT_LAYOUT.map(b => ({ ...b })));

  const reorder = (dragged, target) => persist(prev => {
    const arr = [...prev];
    const from = arr.findIndex(b => b.type === dragged);
    const to   = arr.findIndex(b => b.type === target);
    if (from < 0 || to < 0 || from === to) return prev;
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    return arr;
  });

  const onDragOver = (targetType) => {
    if (!draggingType || draggingType === targetType) return;
    reorder(draggingType, targetType);
  };

  // ── Drag-to-resize width (edit mode) ──────────────────────
  // The grid is `repeat(12, 1fr)`, so "freeform" width still snaps to whole
  // columns — measure the grid's actual column+gap width in pixels so a
  // drag of that many pixels moves the span by exactly 1.
  const GRID_COLS = 12;
  const GRID_GAP = 24; // must match .dash-grid's `gap` in Dashboard.css
  const startResize = (type, e) => {
    e.preventDefault();
    e.stopPropagation();
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    const pxPerSpan = (rect.width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS + GRID_GAP;
    const startX = e.clientX;
    const startSpan = spanFor(layout.find(b => b.type === type)?.size);

    setResizingType(type);

    const onMove = (moveEvent) => {
      const deltaSpans = Math.round((moveEvent.clientX - startX) / pxPerSpan);
      const nextSpan = Math.max(1, Math.min(GRID_COLS, startSpan + deltaSpans));
      setLayout(prev => prev.map(b => (
        b.type === type && spanFor(b.size) !== nextSpan ? { ...b, size: nextSpan } : b
      )));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizingType(null);
      // onMove only updated local state (to avoid saving on every pixel) —
      // persist the final span now.
      setLayout(prev => { savePrefs(prev); return prev; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Data ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: allTasks }, allUsers, { data: allProjects }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    const active = (allTasks || []).filter(t => t.status !== 'completed');
    const done = (allTasks || []).filter(t => t.status === 'completed');
    setTasks(active);
    setCompletedTasks(done);
    setUsers(allUsers || []);
    setProjects(allProjects || []);
    setLoading(false);

    // Persist counts so the next mount can render them without a 0-flash.
    const counts = {
      critical:    active.filter(t => t.status === 'critical' || t.roi === 'critical').length,
      open:        active.filter(t => t.status === 'open').length,
      in_progress: active.filter(t => t.status === 'in_progress').length,
      on_hold:     active.filter(t => t.status === 'on_hold').length,
      completed:   done.length,
    };
    setStatCache(counts);
    try { localStorage.setItem(STAT_CACHE_KEY, JSON.stringify(counts)); } catch {}
  }, [activeTeamId]);

  const fetchQueue = useCallback(async () => {
    if (!activeTeamId) { setQueue([]); setQueueLoaded(true); return; }
    const { data } = await supabase
      .from('queue')
      .select('id, task_id, position, tasks(*)')
      .eq('team_id', activeTeamId)
      .order('position');
    setQueue((data || []).filter(q => q.tasks));
    setQueueLoaded(true);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    fetchQueue();
    const channel = supabase
      .channel('dashboard-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, fetchQueue)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, () => { fetchQueue(); fetchData(); })
      .subscribe();
    const handler = () => { fetchQueue(); fetchData(); };
    window.addEventListener('queue-changed', handler);
    window.addEventListener('tasks-changed', handler);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('queue-changed', handler);
      window.removeEventListener('tasks-changed', handler);
    };
  }, [fetchQueue, fetchData]);

  const inProgress = useMemo(() => tasks.filter(t => t.status === 'in_progress'), [tasks]);

  // How many focus slots to show scales with the widget's own width — a
  // widget spanning all 12 grid columns (full) shows 3, half that width
  // shows roughly half as many, etc. (4 grid columns ≈ 1 slot).
  const focusSpan = spanFor(layout.find(b => b.type === 'focus')?.size);
  const focusVisibleCount = Math.max(1, Math.round(focusSpan / 4));

  const focusTasks = useMemo(() => {
    const seen = new Set();
    const list = [];
    inProgress.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); list.push(t); } });
    queue.forEach(q => { if (q.tasks && !seen.has(q.tasks.id)) { seen.add(q.tasks.id); list.push(q.tasks); } });
    return list.slice(0, focusVisibleCount);
  }, [inProgress, queue, focusVisibleCount]);

  // Reload the cached focus when the team changes.
  useEffect(() => { setFocusCache(loadFocusCache(activeTeamId)); }, [activeTeamId]);

  // Once the live data has actually loaded, it's authoritative — persist it so
  // the next mount can paint it instantly.
  const focusReady = !loading && queueLoaded;
  useEffect(() => {
    if (!focusReady || !activeTeamId) return;
    setFocusCache(focusTasks);
    try { localStorage.setItem(FOCUS_CACHE_KEY, JSON.stringify({ teamId: activeTeamId, tasks: focusTasks })); } catch { /* ignore */ }
  }, [focusReady, focusTasks, activeTeamId]);

  // What to render: live tasks once ready, otherwise the cached list so there's
  // no empty flash while the first fetch is in flight.
  const displayFocus = focusReady ? focusTasks : (focusCache.length ? focusCache : focusTasks);

  const statCount = (key) => {
    // While the first fetch is in flight, show cached counts (no 0-flash).
    if (loading) return statCache[key] ?? 0;
    if (key === 'completed') return completedTasks.length;
    // Critical = critical status OR critical ROI (both are "urgent").
    if (key === 'critical') return tasks.filter(t => t.status === 'critical' || t.roi === 'critical').length;
    return tasks.filter(t => t.status === key).length;
  };

  const widgetCtx = { tasks, completedTasks, users, profile };

  // ── Block content (normal mode) ───────────────────────────
  const renderContent = (type) => {
    switch (type) {
      case 'focus':
        return (
          <section className="dashboard-section">
            <h2 className="section-title">
              <span className="status-dot status-dot-inprogress" />
              Current Focus
              <span className="focus-hint">in progress &amp; up next</span>
              {displayFocus.length > 0 && (
                <button
                  className={`btn btn-sm ${focusSelect.selectMode ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ marginLeft: 'auto' }}
                  onClick={focusSelect.toggleSelectMode}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  {focusSelect.selectMode ? 'Done' : 'Select'}
                </button>
              )}
            </h2>
            {displayFocus.length > 0 ? (
              <div className="tasks-featured-grid" style={{ gridTemplateColumns: `repeat(${focusVisibleCount}, 1fr)` }}>
                {displayFocus.map((task, i) => {
                  const isCurrent = task.status === 'in_progress';
                  const upNextNum = displayFocus.slice(0, i + 1).filter(t => t.status !== 'in_progress').length;
                  return (
                    <div key={task.id} className="focus-slot" style={{ animationDelay: `${i * 60}ms` }}>
                      <span className={`focus-order-tag ${isCurrent ? 'focus-order-tag-current' : ''}`}>
                        {isCurrent ? (<><span className="focus-tag-dot" /> In Progress</>) : (`Up Next · ${upNextNum}`)}
                      </span>
                      <TaskCard task={task} onEdit={setEditTask} onDeleted={fetchData} featured users={users} projects={projects}
                        selectMode={focusSelect.selectMode} selected={focusSelect.selectedIds.has(task.id)} onToggleSelect={focusSelect.toggle} />
                    </div>
                  );
                })}
              </div>
            ) : focusReady ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, padding: 28 }}>
                Nothing in focus. Start a task or add one to your queue.
              </div>
            ) : (
              // First-ever load with no cache yet — brief placeholder.
              <div className="tasks-featured-grid" style={{ gridTemplateColumns: `repeat(${focusVisibleCount}, 1fr)` }}>
                {Array.from({ length: focusVisibleCount }).map((_, i) => (
                  <div key={i} className="task-skeleton loading-pulse" />
                ))}
              </div>
            )}
          </section>
        );

      case 'allTasks':
        return <ActiveTasksList />;

      case 'activityChart':  return <ActivityChartWidget {...widgetCtx} />;
      case 'completedToday': return <CompletedTodayWidget {...widgetCtx} />;
      case 'notifications':  return <NotificationCenter />;
      case 'roiBreakdown':   return <RoiBreakdownWidget {...widgetCtx} />;
      case 'leaderboard':    return <LeaderboardWidget {...widgetCtx} />;
      case 'recentActivity': return <RecentActivityWidget {...widgetCtx} />;
      case 'streak':         return <StreakWidget {...widgetCtx} />;
      case 'queue':          return <QueueWidget />;
      case 'pomodoro':       return <PomodoroWidget />;
      case 'pet':            return <PetWidget />;
      case 'projects':       return <ProjectsWidget />;
      default:               return null;
    }
  };

  // ── Edit-mode placeholder ─────────────────────────────────
  const renderPlaceholder = (block) => {
    const meta = WIDGETS[block.type];
    return (
      <div className={`dash-ph ${draggingType === block.type ? 'dash-ph-dragging' : ''}`}>
        <div className="dash-ph-center">
          <svg className="dash-ph-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={meta.icon} /></svg>
          <span className="dash-ph-name">{meta.name}</span>
          {meta.locked && <span className="dash-ph-lock">Locked</span>}
        </div>

        <div className="dash-ph-controls" onMouseDown={e => e.stopPropagation()}>
          <div className="dash-size-seg">
            {SIZES.map(s => (
              <button key={s.key}
                className={`dash-size-btn ${spanFor(block.size) === s.span ? 'dash-size-active' : ''}`}
                onClick={() => changeSize(block.type, s.key)}
                title={`Width: ${s.label}`}>
                {s.label}
              </button>
            ))}
          </div>
          {!meta.locked && (
            <button className="dash-remove" onClick={() => removeBlock(block.type)} title="Remove widget" aria-label="Remove widget">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <span className="dash-ph-grip" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <div
          className={`dash-resize-handle ${resizingType === block.type ? 'dash-resize-active' : ''}`}
          onMouseDown={e => startResize(block.type, e)}
          draggable={false}
          title="Drag to resize width"
          aria-label="Drag to resize width"
        >
          <span className="dash-resize-grip" aria-hidden="true" />
        </div>
      </div>
    );
  };

  // Wrapper that handles drag + card chrome for a block.
  const renderCell = (block) => {
    const dragProps = editing ? {
      draggable: true,
      onDragStart: () => setDraggingType(block.type),
      onDragEnter: () => onDragOver(block.type),
      onDragOver: (e) => { e.preventDefault(); },
      onDragEnd: () => setDraggingType(null),
      onDrop: (e) => { e.preventDefault(); setDraggingType(null); },
    } : {};

    const style = { gridColumn: `span ${spanFor(block.size)}` };

    const inner = editing
      ? renderPlaceholder(block)
      : (SELF_CONTAINED.has(block.type)
          ? renderContent(block.type)
          : <div className={`dash-card ${block.type === 'pet' ? 'dash-card-pet' : ''}`}>{renderContent(block.type)}</div>);

    return (
      <div key={block.type} className={`dash-cell ${editing ? 'dash-cell-edit' : ''}`} style={style} {...dragProps}>
        {inner}
      </div>
    );
  };

  // The pet widget is force-hidden (not offerable to add back, and any
  // saved instance of it doesn't render) whenever gamification is off —
  // personally opted out, or the active team has it disabled.
  const visibleLayout = gamificationEnabled ? layout : layout.filter(b => b.type !== 'pet');
  const available = Object.keys(WIDGETS)
    .filter(t => !WIDGETS[t].locked && !layout.some(b => b.type === t))
    .filter(t => gamificationEnabled || t !== 'pet');

  return (
    <div className="dashboard fade-in">
      {/* Header actions → global top bar */}
      <TopBarPortal>
          {editing ? (
            <>
              <div className="dash-dt-toggles">
                <span className="dash-dt-toggles-label">Top bar:</span>
                <button
                  className={`dash-dt-toggle ${display.date ? 'dash-dt-toggle-on' : ''}`}
                  onClick={() => toggleDisplay('date')}
                  aria-pressed={display.date}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Date
                </button>
                <button
                  className={`dash-dt-toggle ${display.time ? 'dash-dt-toggle-on' : ''}`}
                  onClick={() => toggleDisplay('time')}
                  aria-pressed={display.time}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
                  Time
                </button>
              </div>
              <button className="btn btn-ghost" onClick={resetLayout}>Reset to default</button>
              <button className="btn btn-secondary" onClick={() => setShowAddWidget(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Widget
              </button>
              <button className="btn btn-primary" onClick={() => { setEditing(false); setDraggingType(null); saveUserPrefs(uid, { dashboard_layout: { blocks: sanitizeLayout(layout), display } }); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Done
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9 M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
                Edit Dashboard
              </button>
              <button className="btn btn-secondary" onClick={() => setShowQuickLog(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Quick Log
              </button>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                New Task
              </button>
            </>
          )}
      </TopBarPortal>

      {/* Task counts — locked top bar (always present) */}
      <div className={`stats-grid ${editing ? 'stats-grid-locked' : ''}`}>
        {editing && <span className="dash-locked-tag">Task Counts · Locked</span>}
        {STATUS_FILTERS.map(s => (
          <button key={s.key}
            className="stat-card stat-card-btn"
            onClick={() => navigate('/active', { state: { status: s.key } })}
            title={`View ${s.label} tasks`}>
            <div className="stat-value" style={{ color: s.color }}>{statCount(s.key)}</div>
            <div className="stat-label">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Widget grid */}
      <div className="dash-grid" ref={gridRef}>
        {visibleLayout.map(b => renderCell(b))}
      </div>

      {/* Add Widget modal */}
      {showAddWidget && (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setShowAddWidget(false)}>
          <div className="modal dash-add-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add a widget</h2>
              <button className="nc-icon-btn" onClick={() => setShowAddWidget(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-body">
              {available.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: 20 }}>
                  Every widget is already on your dashboard.
                </p>
              ) : (
                <div className="dash-add-grid">
                  {available.map(type => {
                    const meta = WIDGETS[type];
                    return (
                      <button key={type} className="dash-add-card" onClick={() => { addBlock(type); setShowAddWidget(false); }}>
                        <span className="dash-add-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={meta.icon} /></svg>
                        </span>
                        <span className="dash-add-name">{meta.name}</span>
                        <span className="dash-add-desc">{meta.desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {showCreate && (
        <TaskForm onClose={() => setShowCreate(false)} onSaved={fetchData} users={users} projects={projects} />
      )}
      {editTask && (
        <TaskForm task={editTask} onClose={() => setEditTask(null)} onSaved={fetchData} users={users} projects={projects} />
      )}
      {showQuickLog && <QuickLogModal onClose={() => setShowQuickLog(false)} />}

      {focusSelect.selectMode && (
        <BulkActionBar
          selectedTasks={[...tasks, ...completedTasks].filter(t => focusSelect.selectedIds.has(t.id))}
          users={users}
          onChanged={fetchData}
          onClear={focusSelect.clear}
          onExit={focusSelect.exitSelectMode}
        />
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
