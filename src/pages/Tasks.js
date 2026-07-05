import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { InlineClock } from '../components/dashboardWidgets';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import QuickLogModal from './QuickLog';
import '../components/TaskCard.css';
import './Dashboard.css';
import './Tasks.css';

const STATUSES = [
  { value: 'all',         label: 'All Tasks' },
  { value: 'critical',    label: 'Critical' },
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold',     label: 'On Hold' },
  { value: 'completed',   label: 'Completed' },
];

const ROI_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export default function Tasks() {
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [roiFilter, setRoiFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [editTask, setEditTask] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickLog, setShowQuickLog] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setTasks([]); setUsers([]); setProjects([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: allTasks }, allUsers, { data: allProjects }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    setTasks(allTasks || []);
    setUsers((allUsers || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
    setProjects(allProjects || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = tasks
    .filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (roiFilter !== 'all' && t.roi !== roiFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.page?.toLowerCase().includes(q) ||
          t.feedback?.toLowerCase().includes(q) ||
          t.noticed_by?.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      // Pin critical to top when viewing all tasks
      if (statusFilter === 'all') {
        const aCrit = a.status === 'critical' ? 0 : 1;
        const bCrit = b.status === 'critical' ? 0 : 1;
        if (aCrit !== bCrit) return aCrit - bCrit;
      }
      if (sortBy === 'date_desc') return new Date(b.date_received) - new Date(a.date_received);
      if (sortBy === 'date_asc') return new Date(a.date_received) - new Date(b.date_received);
      if (sortBy === 'roi') return (ROI_ORDER[a.roi] ?? 4) - (ROI_ORDER[b.roi] ?? 4);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      return 0;
    });

  const counts = {};
  STATUSES.forEach(s => {
    counts[s.value] = s.value === 'all' ? tasks.length : tasks.filter(t => t.status === s.value).length;
  });

  return (
    <div className="dashboard fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">All Tasks</h1>
          <p className="page-subtitle">{filtered.length} task{filtered.length !== 1 ? 's' : ''} shown</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <InlineClock />
          <button className="btn btn-secondary" onClick={() => setShowQuickLog(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Quick Log
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Task
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="status-tabs">
        {STATUSES.map(s => (
          <button
            key={s.value}
            className={`status-tab ${statusFilter === s.value ? 'status-tab-active' : ''}`}
            onClick={() => setStatusFilter(s.value)}
          >
            {s.label}
            <span className="tab-count">{counts[s.value]}</span>
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="filters-row">
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="input" placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38 }} />
        </div>

        <select className="input" style={{ width: 'auto' }} value={roiFilter} onChange={e => setRoiFilter(e.target.value)}>
          <option value="all">All ROI</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select className="input" style={{ width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date_desc">Newest First</option>
          <option value="date_asc">Oldest First</option>
          <option value="roi">By ROI</option>
          <option value="status">By Status</option>
        </select>
      </div>

      {/* Task grid */}
      {loading ? (
        <div className="loading-grid">
          {[1,2,3,4,5,6].map(i => <div key={i} className="task-skeleton loading-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2" />
          </svg>
          <h3>No tasks found</h3>
          <p>Try adjusting your filters or create a new task</p>
        </div>
      ) : (
        <div className="tasks-grid">
          {filtered.map(task => (
            <TaskCard key={task.id} task={task} onEdit={setEditTask} onDeleted={fetchData} users={users} projects={projects} />
          ))}
        </div>
      )}

      {showCreate && (
        <TaskForm onClose={() => setShowCreate(false)} onSaved={fetchData} users={users} projects={projects} />
      )}
      {editTask && (
        <TaskForm task={editTask} onClose={() => setEditTask(null)} onSaved={fetchData} users={users} projects={projects} />
      )}
      {showQuickLog && (
        <QuickLogModal onClose={() => setShowQuickLog(false)} />
      )}
    </div>
  );
}
