import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isSameMonth, eachDayOfInterval, startOfMonth, endOfMonth, isAfter, startOfDay } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { completeTask } from '../lib/completeTask';
import useRefresh from '../lib/useRefresh';
import { taskTitle, pageLabel } from '../lib/taskText';
import { openTask, openNewTask, tasksChanged, queueChanged, TASKS_CHANGED, QUEUE_CHANGED } from '../lib/events';
import { TopBarPortal } from '../context/HeaderActionsContext';
import TaskTable, { GROUPS } from '../components/TaskTable';
import { Icon, Menu, MenuItem, useMenu, SearchInput, shortDate, cap, toast, fullName } from '../ui';
import './Dashboard.css';

const ROI_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CACHE = 'tf-dash-cache-v2';
const loadCache = (team) => {
  try { const c = JSON.parse(localStorage.getItem(CACHE)); return c && c.team === team ? c : null; } catch { return null; }
};

// One line under a task title: page · priority · date
function TaskMeta({ t }) {
  const page = pageLabel(t.page);
  return (
    <span className="db-meta">
      {page && <span className="truncate">{page}</span>}
      {page && <span className="db-dot">·</span>}
      <span className={`prio prio-${t.roi}`}>{cap(t.roi || 'medium')}</span>
      <span className="db-dot">·</span>
      <span>{shortDate(t.date_received || t.created_at)}</span>
    </span>
  );
}

function FocusRow({ t, index, actions, drag }) {
  return (
    <div
      className={`db-frow ${drag?.isDragging ? 'is-dragging' : ''} ${drag?.dropClass || ''}`}
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
    >
      {drag && <span className="grip db-grip" aria-hidden="true"><Icon name="grip" size={14} stroke={2.4} /></span>}
      {index != null && <span className="db-fnum mono">{index}</span>}
      <button type="button" className="db-fmain" onClick={() => openTask(t)}>
        <span className="db-ftitle">{taskTitle(t)}</span>
        <TaskMeta t={t} />
      </button>
      <div className="db-factions">{actions}</div>
    </div>
  );
}

/** Daily completions for the month, as a bar per day. */
function MonthChart({ completed, month }) {
  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const counts = useMemo(() => {
    const m = new Map();
    completed.forEach(t => {
      if (!t.date_completed) return;
      const k = format(new Date(t.date_completed), 'yyyy-MM-dd');
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [completed]);
  const max = Math.max(1, ...days.map(d => counts.get(format(d, 'yyyy-MM-dd')) || 0));
  const todayIdx = days.findIndex(d => isToday(d));
  const [hover, setHover] = useState(null);

  return (
    <div className="db-chart" onMouseLeave={() => setHover(null)}>
      <div className="db-bars">
        {days.map((d, i) => {
          const n = counts.get(format(d, 'yyyy-MM-dd')) || 0;
          const future = isAfter(startOfDay(d), startOfDay(new Date()));
          return (
            <div
              key={i}
              className={`db-bar-slot ${isToday(d) ? 'is-today' : ''} ${hover === i ? 'is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
            >
              {n > 0 ? (
                <span className="db-bar" style={{ height: `${Math.max(8, (n / max) * 100)}%`, animationDelay: `${i * 14}ms` }} />
              ) : (
                <span className={`db-bar-empty ${future ? 'is-future' : ''}`} />
              )}
              {hover === i && (
                <span className="db-tip">{format(d, 'MMM d')} · {n} done</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="db-axis mono">
        <span>{format(days[0], 'MMM d')}</span>
        {todayIdx > 3 && todayIdx < days.length - 4 && (
          <span className="db-axis-today" style={{ left: `${((todayIdx + 0.5) / days.length) * 100}%` }}>Today</span>
        )}
        <span>{format(days[days.length - 1], 'MMM d')}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const cached = loadCache(activeTeamId);
  const [tasks, setTasks] = useState(cached?.tasks || []);
  const [queue, setQueue] = useState(cached?.queue || []);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(!cached);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('tf-dash-group') || 'status');
  const [statFilter, setStatFilter] = useState(null);
  const [busy, setBusy] = useState(null);
  const groupMenu = useMenu();
  const tableRef = useRef(null);
  const myName = fullName(profile);
  const navigate = useNavigate();

  const { run: fetchData, refresh } = useRefresh(async (isStale) => {
    if (!activeTeamId) { setTasks([]); setQueue([]); setLoading(false); return; }
    const [{ data: all }, members, { data: q }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
      supabase.from('queue').select('id, task_id, position').eq('team_id', activeTeamId).order('position'),
    ]);
    if (isStale()) return;
    setTasks(all || []);
    setQueue(q || []);
    setUsers(members || []);
    setLoading(false);
    try {
      // Only the active tasks + this month's completions — enough to paint instantly next time.
      const keep = (all || []).filter(t => t.status !== 'completed' || (t.date_completed && isSameMonth(new Date(t.date_completed), new Date())));
      localStorage.setItem(CACHE, JSON.stringify({ team: activeTeamId, tasks: keep.slice(0, 400), queue: q || [] }));
    } catch { /* quota */ }
  });

  useEffect(() => {
    fetchData();
    const channel = supabase.channel(`dashboard-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refresh)
      .subscribe();
    window.addEventListener(TASKS_CHANGED, refresh);
    window.addEventListener(QUEUE_CHANGED, refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(TASKS_CHANGED, refresh);
      window.removeEventListener(QUEUE_CHANGED, refresh);
    };
  }, [activeTeamId, fetchData, refresh]);

  const active = useMemo(() => tasks.filter(t => t.status !== 'completed'), [tasks]);
  const completed = useMemo(() => tasks.filter(t => t.status === 'completed'), [tasks]);
  const inProgress = useMemo(() => active.filter(t => t.status === 'in_progress'), [active]);
  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const upNext = useMemo(() => queue
    .map(q => ({ q, t: byId.get(q.task_id) }))
    .filter(x => x.t && x.t.status !== 'completed' && x.t.status !== 'in_progress'), [queue, byId]);
  const suggestions = useMemo(() => active
    .filter(t => t.status !== 'in_progress' && t.status !== 'on_hold' && !queue.some(q => q.task_id === t.id))
    .sort((a, b) => (ROI_RANK[a.roi] ?? 4) - (ROI_RANK[b.roi] ?? 4) || new Date(a.date_received) - new Date(b.date_received))
    .slice(0, 3), [active, queue]);

  const month = new Date();
  const monthDone = completed.filter(t => t.date_completed && isSameMonth(new Date(t.date_completed), month));
  const doneToday = completed.filter(t => t.date_completed && isToday(new Date(t.date_completed))).length;

  const stats = [
    { key: 'critical', label: 'Critical', n: active.filter(t => t.status === 'critical' || t.roi === 'critical').length },
    { key: 'open', label: 'Open', n: active.filter(t => t.status === 'open').length },
    { key: 'in_progress', label: 'In progress', n: inProgress.length },
    { key: 'on_hold', label: 'On hold', n: active.filter(t => t.status === 'on_hold').length },
    { key: 'completed', label: 'Completed', n: completed.length, ok: true, to: '/completed' },
    { key: 'today', label: 'Done today', n: doneToday, to: '/completed' },
  ];

  // ── Focus actions ──
  const start = async (t) => {
    setBusy(t.id);
    const now = new Date().toISOString();
    setTasks(list => list.map(x => (x.id === t.id ? { ...x, status: 'in_progress' } : x)));
    await Promise.all([
      supabase.from('tasks').update({ status: 'in_progress', updated_at: now }).eq('id', t.id),
      supabase.from('queue').delete().eq('task_id', t.id),
    ]);
    setBusy(null);
    toast('Started — it’s in your focus');
    tasksChanged(); queueChanged();
  };
  const finish = async (t) => {
    setBusy(t.id);
    setTasks(list => list.map(x => (x.id === t.id ? { ...x, status: 'completed', date_completed: new Date().toISOString() } : x)));
    await completeTask({ task: t, completedBy: [myName || 'Someone'], userId: user?.id, teamId: activeTeamId, wasQueued: true });
    setBusy(null);
    toast('Nice — task completed');
  };
  const pause = async (t) => {
    setTasks(list => list.map(x => (x.id === t.id ? { ...x, status: 'open' } : x)));
    await supabase.from('tasks').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', t.id);
    tasksChanged();
  };
  const dequeue = async (q) => {
    setQueue(list => list.filter(x => x.id !== q.id));
    await supabase.from('queue').delete().eq('id', q.id);
    queueChanged();
  };
  const enqueue = async (t) => {
    const pos = (queue[queue.length - 1]?.position || 0) + 1;
    setQueue(list => [...list, { id: `tmp-${t.id}`, task_id: t.id, position: pos }]);
    await supabase.from('queue').insert({ task_id: t.id, team_id: activeTeamId, position: pos });
    toast('Added to up next');
    queueChanged();
  };

  // Drag to reorder "Up next".
  const [dragId, setDragId] = useState(null);
  const [drop, setDrop] = useState(null);
  const reorder = async (fromId, toId, after) => {
    const ids = upNext.map(x => x.q.id);
    const from = ids.indexOf(fromId);
    if (from < 0) return;
    ids.splice(from, 1);
    let to = ids.indexOf(toId);
    if (to < 0) return;
    if (after) to += 1;
    ids.splice(to, 0, fromId);
    const pos = new Map(ids.map((id, i) => [id, i + 1]));
    setQueue(list => [...list].map(q => (pos.has(q.id) ? { ...q, position: pos.get(q.id) } : q)).sort((a, b) => a.position - b.position));
    await Promise.all(ids.filter(id => !String(id).startsWith('tmp-')).map((id, i) => supabase.from('queue').update({ position: i + 1 }).eq('id', id)));
    queueChanged();
  };
  const dragProps = (q) => ({
    isDragging: dragId === q.id,
    dropClass: drop?.id === q.id ? (drop.after ? 'drop-after' : 'drop-before') : '',
    onDragStart: (e) => { setDragId(q.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', q.id); },
    onDragOver: (e) => {
      if (!dragId || dragId === q.id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setDrop({ id: q.id, after: e.clientY > r.top + r.height / 2 });
    },
    onDrop: (e) => { e.preventDefault(); if (dragId && drop) reorder(dragId, drop.id, drop.after); setDragId(null); setDrop(null); },
    onDragEnd: () => { setDragId(null); setDrop(null); },
  });

  // ── All active tasks ──
  const shown = useMemo(() => {
    let list = active;
    if (statFilter === 'critical') list = list.filter(t => t.status === 'critical' || t.roi === 'critical');
    else if (statFilter) list = list.filter(t => t.status === statFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(t => [taskTitle(t), t.page, t.noticed_by, t.feedback].some(v => (v || '').toLowerCase().includes(q)));
    }
    return list;
  }, [active, statFilter, search]);

  const pickStat = (s) => {
    if (s.to) { navigate(s.to); return; }
    setStatFilter(f => (f === s.key ? null : s.key));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const setGroup = (g) => { setGroupBy(g); try { localStorage.setItem('tf-dash-group', g); } catch { /* ignore */ } };

  const hasFocus = inProgress.length > 0 || upNext.length > 0;

  return (
    <div className="db">
      <TopBarPortal>
        <button type="button" className="btn btn-primary" onClick={() => openNewTask()}>
          <Icon name="plus" size={15} stroke={2.2} /><span className="hide-phone">New task</span><span className="show-phone">New</span>
        </button>
      </TopBarPortal>

      <div className="db-top">
        <section className="db-focus anim-rise">
          <div className="eyebrow">Current focus</div>
          {!hasFocus ? (
            <>
              <h1 className="db-headline">Nothing in focus yet.</h1>
              <p className="db-lede">
                {suggestions.length ? 'Pick one of these to start. High priority and oldest first.' : 'You’re all caught up. Add a task to get going.'}
              </p>
              {suggestions.length > 0 && (
                <div className="db-flist stagger">
                  {suggestions.map(t => (
                    <FocusRow
                      key={t.id} t={t}
                      actions={<>
                        <button type="button" className="btn btn-ghost btn-sm db-qbtn hide-phone" onClick={() => enqueue(t)} title="Add to up next">
                          <Icon name="queue" size={14} />
                        </button>
                        <button type="button" className="btn" onClick={() => start(t)} disabled={busy === t.id}>Start</button>
                      </>}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {inProgress.length > 0 ? (
                <div className="db-now stagger">
                  {inProgress.map(t => (
                    <div key={t.id} className="db-now-item">
                      <span className="db-now-label"><span className="dot dot-in_progress dot-pulse" style={{ color: 'var(--st-inprogress)' }} />In progress</span>
                      <button type="button" className="db-headline db-headline-btn" onClick={() => openTask(t)}>{taskTitle(t)}</button>
                      <div className="db-now-foot">
                        <TaskMeta t={t} />
                        <div className="db-now-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pause(t)}>Pause</button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => finish(t)} disabled={busy === t.id}>
                            <Icon name="check" size={13} stroke={2.4} />Done
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <h1 className="db-headline">Ready for the next one.</h1>
                  <p className="db-lede">Start whatever’s at the top of your queue.</p>
                </>
              )}
              {upNext.length > 0 && (
                <>
                  <div className="db-sub-head"><span className="eyebrow">Up next</span><span className="count">{upNext.length}</span></div>
                  <div className="db-flist stagger">
                    {upNext.map(({ q, t }, i) => (
                      <FocusRow
                        key={q.id} t={t} index={i + 1} drag={dragProps(q)}
                        actions={<>
                          <button type="button" className="btn btn-ghost btn-sm btn-icon db-x" onClick={() => dequeue(q)} title="Remove from queue" aria-label="Remove from queue">
                            <Icon name="x" size={13} />
                          </button>
                          <button type="button" className="btn" onClick={() => start(t)} disabled={busy === t.id}>Start</button>
                        </>}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <section className="db-month anim-rise" style={{ animationDelay: '60ms' }}>
          <div className="eyebrow">Completed in {format(month, 'MMMM')}</div>
          <div className="db-month-row">
            <span key={monthDone.length} className="db-big num">{monthDone.length}</span>
            <span className="db-alltime">{completed.length} all-time</span>
          </div>
          <MonthChart completed={monthDone} month={month} />
          <div className="db-stats">
            {stats.map((s, i) => (
              <button
                key={s.key} type="button"
                className={`db-stat stat stat-btn ${statFilter === s.key ? 'is-on' : ''}`}
                onClick={() => pickStat(s)}
                style={{ animationDelay: `${120 + i * 30}ms` }}
              >
                <span key={s.n} className={`stat-num ${s.ok ? 't-ok' : ''}`}>{loading ? '–' : s.n}</span>
                <span className="stat-label">{s.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="db-all" ref={tableRef}>
        <div className="db-all-head">
          <h2 className="section-title">
            {statFilter ? `${stats.find(s => s.key === statFilter)?.label} tasks` : 'All active tasks'}
            {statFilter && (
              <button type="button" className="db-clear" onClick={() => setStatFilter(null)}>
                <Icon name="x" size={12} />Clear
              </button>
            )}
          </h2>
          <div className="toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search tasks" />
            <button ref={groupMenu.anchorRef} type="button" className="btn" onClick={groupMenu.toggle}>
              Group: {GROUPS.find(g => g.value === groupBy)?.label}
            </button>
            <Menu {...groupMenu.props} align="end" width={180}>
              {GROUPS.map(g => <MenuItem key={g.value} checked={groupBy === g.value} onClick={() => setGroup(g.value)}>{g.label}</MenuItem>)}
            </Menu>
          </div>
        </div>
        <TaskTable
          tasks={shown}
          users={users}
          groupBy={groupBy}
          loading={loading && !tasks.length}
          columns={['task', 'page', 'priority', 'noticed', 'posted']}
          empty={search ? 'No tasks match that search.' : 'No active tasks. Enjoy it.'}
        />
      </section>
    </div>
  );
}
