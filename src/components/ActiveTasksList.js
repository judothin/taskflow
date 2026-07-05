import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import TaskCard from './TaskCard';
import TaskForm from './TaskForm';
import './TaskCard.css';
import '../pages/Dashboard.css';

const STATUS_FILTERS = [
  { key: 'critical',    label: 'Critical',    color: 'var(--st-critical)' },
  { key: 'open',        label: 'Open',        color: 'var(--st-open)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--st-inprogress)' },
  { key: 'on_hold',     label: 'On Hold',     color: 'var(--st-onhold)' },
  { key: 'completed',   label: 'Completed',   color: 'var(--st-completed)' },
];
const ROI_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// Self-contained active-tasks list — used both as a dashboard widget and on the
// dedicated Active Tasks page. It fetches its own data and re-reads on the
// app's `tasks-changed` / `queue-changed` events (fired by TaskForm/TaskCard),
// so it stays in sync no matter where a task is created or edited.
export default function ActiveTasksList({ initialStatus = 'all', showTitle = true, showNewTask = false }) {
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTask, setEditTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [roiFilter, setRoiFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [sortBy, setSortBy] = useState('date_desc');

  useEffect(() => { setStatusFilter(initialStatus); }, [initialStatus]);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setTasks([]); setCompletedTasks([]); setUsers([]); setProjects([]); setLoading(false); return; }
    const [{ data: allTasks }, allUsers, { data: allProjects }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    setTasks((allTasks || []).filter(t => t.status !== 'completed'));
    setCompletedTasks((allTasks || []).filter(t => t.status === 'completed'));
    setUsers(allUsers || []);
    setProjects(allProjects || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('active-tasks-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchData)
      .subscribe();
    const handler = () => fetchData();
    window.addEventListener('tasks-changed', handler);
    window.addEventListener('queue-changed', handler);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('tasks-changed', handler);
      window.removeEventListener('queue-changed', handler);
    };
  }, [fetchData]);

  const isCritical = (t) => t.status === 'critical' || t.roi === 'critical';
  const baseList = statusFilter === 'completed' ? completedTasks : tasks;
  const filtered = baseList
    .filter(t => {
      if (statusFilter === 'critical') { if (!isCritical(t)) return false; }
      else if (statusFilter !== 'all' && statusFilter !== 'completed' && t.status !== statusFilter) return false;
      if (roiFilter !== 'all' && t.roi !== roiFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return t.page?.toLowerCase().includes(q) ||
             t.feedback?.toLowerCase().includes(q) ||
             t.noticed_by?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'date_desc') return new Date(b.date_received) - new Date(a.date_received);
      if (sortBy === 'date_asc')  return new Date(a.date_received) - new Date(b.date_received);
      if (sortBy === 'roi')       return (ROI_ORDER[a.roi] ?? 4) - (ROI_ORDER[b.roi] ?? 4);
      if (sortBy === 'status')    return a.status.localeCompare(b.status);
      const aCrit = isCritical(a) ? 0 : 1;
      const bCrit = isCritical(b) ? 0 : 1;
      if (aCrit !== bCrit) return aCrit - bCrit;
      return new Date(b.date_received) - new Date(a.date_received);
    });

  const activeFilter = STATUS_FILTERS.find(s => s.key === statusFilter);
  const listTitle = statusFilter === 'all' ? 'All Active Tasks' : `${activeFilter?.label} Tasks`;
  const hasFilters = search || roiFilter !== 'all' || statusFilter !== 'all';

  return (
    <section className="dashboard-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        {showTitle
          ? <h2 className="section-title" style={{ margin: 0 }}>{listTitle}</h2>
          : <span />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {showNewTask && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Task
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input className="input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, width: 170 }} />
          </div>
          <select className="input" style={{ width: 'auto' }} value={roiFilter} onChange={e => setRoiFilter(e.target.value)}>
            <option value="all">All ROI</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" style={{ width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="default">Default</option>
            <option value="date_desc">Newest First</option>
            <option value="date_asc">Oldest First</option>
            <option value="roi">By ROI</option>
            <option value="status">By Status</option>
          </select>
        </div>
      </div>

      <div className="task-filter-row">
        <button className={`task-filter-btn ${statusFilter === 'all' ? 'task-filter-btn-active' : ''}`} onClick={() => setStatusFilter('all')}>All</button>
        {STATUS_FILTERS.map(s => {
          const active = statusFilter === s.key;
          return (
            <button key={s.key}
              className={`task-filter-btn ${active ? 'task-filter-btn-active' : ''}`}
              style={active ? { color: s.color, borderColor: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` } : undefined}
              onClick={() => setStatusFilter(active ? 'all' : s.key)}>
              <span className="task-filter-dot" style={{ background: s.color }} />
              {s.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="loading-grid">{[1,2,3].map(i => <div key={i} className="task-skeleton loading-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2" /></svg>
          <h3>{hasFilters ? 'No tasks match your filters' : 'No active tasks'}</h3>
          <p>{hasFilters ? 'Try adjusting your search or filters' : 'Create your first task to get started'}</p>
        </div>
      ) : (
        <div className="tasks-grid">
          {filtered.map(task => (
            <TaskCard key={task.id} task={task} onEdit={setEditTask} onDeleted={fetchData} users={users} projects={projects} />
          ))}
        </div>
      )}

      {showCreate && <TaskForm onClose={() => setShowCreate(false)} onSaved={fetchData} users={users} projects={projects} />}
      {editTask && <TaskForm task={editTask} onClose={() => setEditTask(null)} onSaved={fetchData} users={users} projects={projects} />}
    </section>
  );
}
