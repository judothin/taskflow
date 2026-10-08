import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import useRefresh from '../lib/useRefresh';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { TopBarPortal } from '../context/HeaderActionsContext';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import BulkActionBar from '../components/BulkActionBar';
import useBulkSelect from '../lib/useBulkSelect';
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
  const { selectMode, selectedIds, toggle, clear, toggleAll, toggleSelectMode, exitSelectMode } = useBulkSelect();

  // Skeletons on the first load only: flipping `loading` on for every refresh
  // swapped the whole list for placeholders and back each time a task was
  // added — a flash. Refreshes are burst-coalesced and latest-only too
  // (lib/useRefresh).
  const loadedOnce = useRef(false);
  const { run: fetchData, refresh: refreshData } = useRefresh(async (isStale) => {
    if (!activeTeamId) { setTasks([]); setUsers([]); setProjects([]); setLoading(false); return; }
    if (!loadedOnce.current) setLoading(true);
    const [{ data: allTasks }, allUsers, { data: allProjects }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    if (isStale()) return;
    loadedOnce.current = true;
    setTasks(allTasks || []);
    setUsers((allUsers || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
    setProjects(allProjects || []);
    setLoading(false);
  });

  useEffect(() => { fetchData(); }, [activeTeamId, fetchData]);
  // Quick Log and new tasks from the top bar menu / shortcuts are app-wide
  // forms, so they announce saves rather than calling back into this page.
  useEffect(() => {
    window.addEventListener('tasks-changed', refreshData);
    return () => window.removeEventListener('tasks-changed', refreshData);
  }, [refreshData]);

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
      <TopBarPortal>
          <button className={`btn ${selectMode ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleSelectMode}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {selectMode ? 'Done' : 'Select'}
          </button>
          {selectMode && filtered.length > 0 && (
            <button className="btn btn-secondary" onClick={() => toggleAll(filtered.map(t => t.id))}>
              {filtered.every(t => selectedIds.has(t.id)) ? 'Clear all' : 'Select all'}
            </button>
          )}
          <button className="btn btn-primary btn-icon-only" onClick={() => setShowCreate(true)} title="New task (N)" aria-label="New task">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
      </TopBarPortal>

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
            <TaskCard key={task.id} task={task} onEdit={setEditTask} onDeleted={refreshData} users={users} projects={projects}
              selectMode={selectMode} selected={selectedIds.has(task.id)} onToggleSelect={toggle} />
          ))}
        </div>
      )}

      {selectMode && (
        <BulkActionBar
          selectedTasks={tasks.filter(t => selectedIds.has(t.id))}
          users={users}
          onChanged={refreshData}
          onClear={clear}
          onExit={exitSelectMode}
        />
      )}

      {showCreate && (
        <TaskForm onClose={() => setShowCreate(false)} onSaved={refreshData} users={users} projects={projects} />
      )}
      {editTask && (
        <TaskForm task={editTask} onClose={() => setEditTask(null)} onSaved={refreshData} users={users} projects={projects} />
      )}
    </div>
  );
}
