import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { InlineClock } from '../components/dashboardWidgets';
import { format, isSameDay, parseISO } from 'date-fns';
import ContextMenu from '../components/ContextMenu';
import TaskForm from '../components/TaskForm';
import Avatar from '../components/Avatar';
import CompletionCalendar from '../components/CompletionCalendar';
import FeedbackContent from '../components/FeedbackContent';
import QuickLogModal from './QuickLog';
import ModalPortal from '../components/ModalPortal';
import './Dashboard.css';
import './Tasks.css';
import './Completed.css';

const ALL_PURPLE = 'var(--accent)';
const ROI_MAP = { critical: 'badge-critical', high: 'badge-high', medium: 'badge-medium', low: 'badge-low' };

const isUrl = (str) => { try { return Boolean(new URL(str)) && /^https?:\/\//i.test(str); } catch { return false; } };
const shortenUrl = (url) => { try { const u = new URL(url); const path = u.pathname.replace(/\/$/, ''); return u.hostname + (path.length > 28 ? path.slice(0, 28) + '…' : path); } catch { return url; } };
const namesOf = (t) => (t.completed_by || '').split(',').map(s => s.trim()).filter(Boolean);

function CompletedRow({ task, onEdit, onDeleted }) {
  const [imgOpen, setImgOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    await supabase.from('tasks').delete().eq('id', task.id);
    onDeleted?.();
  };

  return (
    <>
      <div
        className="completed-row"
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {/* Main content + meta */}
        <div className="completed-row-inner">
          <div className="completed-row-main">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${ROI_MAP[task.roi] || ''}`}>{task.roi}</span>
              <span className="badge" style={{ background: 'var(--bg-4)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                {task.complexity} complexity
              </span>
            </div>
            <div className="completed-page-label">
              {isUrl(task.page) ? (
                <a href={task.page} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 700 }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                >
                  {shortenUrl(task.page)}
                </a>
              ) : task.page}
            </div>
            <FeedbackContent taskId={task.id} html={task.feedback} className="completed-feedback" onSaved={onDeleted} />
          </div>

          <div className="completed-row-meta">
            <div className="meta-item">
              <span className="meta-label">Noticed By</span>
              <span className="meta-value">{task.noticed_by || '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Completed By</span>
              <span className="meta-value" style={{ color: 'var(--success)' }}>{task.completed_by || '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Received</span>
              <span className="meta-value mono">{task.date_received ? format(new Date(task.date_received), 'MMM d, yyyy') : '—'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Completed</span>
              <span className="meta-value mono" style={{ color: 'var(--success)' }}>
                {task.date_completed ? format(new Date(task.date_completed), 'MMM d, yyyy') : '—'}
              </span>
            </div>
            {task.png_url && (
              <button className="btn btn-ghost btn-sm" onClick={() => setImgOpen(true)}>📎 View</button>
            )}
          </div>
        </div>

        {/* Action sidebar */}
        <div className="task-card-actions" style={{ borderLeft: '1px solid var(--border)', borderRadius: '0 var(--radius-lg) var(--radius-lg) 0' }}>
          <button className="task-action-btn" data-tooltip="Edit" onClick={() => onEdit?.(task)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>

          {!confirmDelete ? (
            <button className="task-action-btn task-action-btn-danger" data-tooltip="Delete" onClick={() => setConfirmDelete(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
          ) : (
            <>
              <button className="task-action-btn task-action-btn-confirm" data-tooltip="Confirm" onClick={handleDelete}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
              <button className="task-action-btn" data-tooltip="Cancel" onClick={() => setConfirmDelete(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          task={task}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onEdit={onEdit}
          onDeleted={onDeleted}
        />
      )}

      {imgOpen && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={() => setImgOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <img src={task.png_url} alt="Task screenshot" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }} />
            <button onClick={() => setImgOpen(false)} style={{ position: 'absolute', top: -12, right: -12, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}

export default function Completed() {
  const location = useLocation();
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_completed_desc');
  const [personFilter, setPersonFilter] = useState('all');
  // Default to today's completions; users can click "View all completed tasks"
  // to clear the date filter and see everything.
  const [selectedDate, setSelectedDate] = useState(() =>
    location.state?.date ? parseISO(location.state.date) : new Date()
  );
  const [editTask, setEditTask] = useState(null);
  const [showQuickLog, setShowQuickLog] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setTasks([]); setUsers([]); setLoading(false); return; }
    setLoading(true);
    const [{ data: allTasks }, allUsers] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).eq('status', 'completed').order('date_completed', { ascending: false }),
      fetchTeamMembers(activeTeamId),
    ]);
    setTasks(allTasks || []);
    setUsers(allUsers || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Unique individual completers (handles "A, B" multi-credit).
  const completors = [...new Set(tasks.flatMap(namesOf))].sort();

  // Colour drives the calendar markers: a person's own colour, else dark purple.
  const calColor = (() => {
    if (personFilter === 'all') return ALL_PURPLE;
    const u = users.find(x => `${x.first_name} ${x.last_name}` === personFilter);
    return u?.color || ALL_PURPLE;
  })();

  // Tasks that feed the calendar (person-scoped, so per-day counts reflect them).
  const personTasks = personFilter === 'all'
    ? tasks
    : tasks.filter(t => namesOf(t).includes(personFilter));

  const filtered = personTasks
    .filter(t => {
      if (selectedDate && !(t.date_completed && isSameDay(new Date(t.date_completed), selectedDate))) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.page?.toLowerCase().includes(q) ||
          t.feedback?.toLowerCase().includes(q) ||
          t.noticed_by?.toLowerCase().includes(q) ||
          t.completed_by?.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'date_completed_asc') return new Date(a.date_completed || 0) - new Date(b.date_completed || 0);
      return new Date(b.date_completed || 0) - new Date(a.date_completed || 0);
    });

  const dateLabel = selectedDate ? format(selectedDate, 'MMM d, yyyy') : null;

  return (
    <div className="dashboard fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Completed Tasks</h1>
          <p className="page-subtitle">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} completed in total
            {personFilter !== 'all' && <> · <strong style={{ color: calColor }}>{personFilter}</strong></>}
            {dateLabel && <> · {dateLabel}</>}
          </p>
        </div>
        <div className="page-header-actions">
          <InlineClock />
          <button className="btn btn-secondary" onClick={() => setShowQuickLog(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Quick Log
          </button>
        </div>
      </div>

      <div className="completed-layout">
        {/* ── Left: calendar + people ── */}
        <aside className="completed-side">
          <div className="completed-cal-card">
            <CompletionCalendar
              tasks={personTasks}
              selectedDate={selectedDate}
              onSelectDate={(d) => setSelectedDate(prev => (prev && isSameDay(prev, d) ? null : d))}
              color={calColor}
            />
            {selectedDate && (
              <button className="completed-clear-date" onClick={() => setSelectedDate(null)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
                View all completed tasks
              </button>
            )}
          </div>

          <div className="completed-people">
            <button
              className={`completed-person-row ${personFilter === 'all' ? 'completed-person-active' : ''}`}
              style={personFilter === 'all' ? { borderColor: ALL_PURPLE } : undefined}
              onClick={() => setPersonFilter('all')}
            >
              <span className="completed-person-swatch" style={{ background: ALL_PURPLE }} />
              <span className="completed-person-name">All Team Members</span>
              <span className="completed-person-count">{tasks.length}</span>
            </button>
            {completors.map(person => {
              const u = users.find(x => `${x.first_name} ${x.last_name}` === person);
              const color = u?.color || ALL_PURPLE;
              const count = tasks.filter(t => namesOf(t).includes(person)).length;
              const active = personFilter === person;
              return (
                <button
                  key={person}
                  className={`completed-person-row ${active ? 'completed-person-active' : ''}`}
                  style={active ? { borderColor: color } : undefined}
                  onClick={() => setPersonFilter(active ? 'all' : person)}
                >
                  <Avatar
                    src={u?.avatar_url}
                    color={color}
                    initials={person.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    size={26}
                  />
                  <span className="completed-person-name">{person}</span>
                  <span className="completed-person-count">{count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right: search + sort + list ── */}
        <div className="completed-main">
          <div className="filters-row">
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input className="input" placeholder="Search completed tasks..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38 }} />
            </div>

            <select className="input" style={{ width: 'auto' }} value={personFilter} onChange={e => setPersonFilter(e.target.value)}>
              <option value="all">All People</option>
              {completors.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            <select className="input" style={{ width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="date_completed_desc">Completed: Newest</option>
              <option value="date_completed_asc">Completed: Oldest</option>
            </select>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <div key={i} className="task-skeleton loading-pulse" style={{ height: 120 }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3" />
              </svg>
              <h3>{search || personFilter !== 'all' || selectedDate ? 'No matches' : 'No completed tasks yet'}</h3>
              <p>{search || personFilter !== 'all' || selectedDate ? 'Try adjusting the date, person, or search' : 'Tasks marked as complete will appear here'}</p>
            </div>
          ) : (
            <div className="completed-results">
              <div className="completed-results-count">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map(task => (
                  <CompletedRow
                    key={task.id}
                    task={task}
                    onEdit={setEditTask}
                    onDeleted={fetchData}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {editTask && (
        <TaskForm
          task={editTask}
          onClose={() => setEditTask(null)}
          onSaved={fetchData}
          users={users}
        />
      )}

      {showQuickLog && (
        <QuickLogModal onClose={() => { setShowQuickLog(false); fetchData(); }} />
      )}
    </div>
  );
}
