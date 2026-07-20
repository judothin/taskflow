import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { awardTaskCompletedXp } from '../lib/xp';
import Avatar from './Avatar';
import FeedbackContent from './FeedbackContent';
import ModalPortal from './ModalPortal';

const STATUS_MAP = {
  critical:    { label: 'Critical',    cls: 'badge-critical',   cardCls: 'task-card-critical' },
  open:        { label: 'Open',        cls: 'badge-open',       cardCls: 'task-card-open' },
  in_progress: { label: 'In Progress', cls: 'badge-inprogress', cardCls: 'task-card-inprogress' },
  on_hold:     { label: 'On Hold',     cls: 'badge-onhold',     cardCls: 'task-card-onhold' },
  completed:   { label: 'Completed',   cls: 'badge-completed',  cardCls: 'task-card-completed' },
};

const isUrl = (str) => { try { return Boolean(new URL(str)) && /^https?:\/\//i.test(str); } catch { return false; } };
const shortenUrl = (url) => { try { const u = new URL(url); const path = u.pathname.replace(/\/$/, ''); return u.hostname + (path.length > 24 ? path.slice(0, 24) + '…' : path); } catch { return url; } };

const ROI_MAP = {
  critical: 'badge-critical',
  high:     'badge-high',
  medium:   'badge-medium',
  low:      'badge-low',
};

export default function TaskCard({ task, onEdit, onDeleted, featured = false, users = [], projects = [] }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const [imgOpen, setImgOpen]             = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completedBy, setCompletedBy]     = useState([]);
  const [completing, setCompleting]       = useState(false);
  const [isQueued, setIsQueued]           = useState(false);
  const [projectPopover, setProjectPopover] = useState(false);
  const popoverRef                        = useRef(null);
  const projectPopoverRef                 = useRef(null);

  const status          = STATUS_MAP[task.status] || STATUS_MAP.open;
  const canQueue        = task.status !== 'in_progress' && task.status !== 'completed';
  const canComplete     = task.status !== 'completed';
  const linkedProject   = projects.find(p => p.id === task.project_id) || null;

  useEffect(() => {
    if (!canQueue) { setIsQueued(false); return; }
    supabase.from('queue').select('id').eq('task_id', task.id)
      .then(({ data }) => setIsQueued(!!(data && data.length > 0)));
  }, [task.id, canQueue]);

  // Close popover on outside click
  useEffect(() => {
    if (!confirmComplete) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setConfirmComplete(false);
        setCompletedBy([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [confirmComplete]);

  useEffect(() => {
    if (!projectPopover) return;
    const handler = (e) => {
      if (projectPopoverRef.current && !projectPopoverRef.current.contains(e.target))
        setProjectPopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [projectPopover]);

  const handleAssignProject = async (projectId) => {
    const newId = task.project_id === projectId ? null : projectId;
    await supabase.from('tasks').update({ project_id: newId, updated_at: new Date().toISOString() }).eq('id', task.id);
    setProjectPopover(false);
    onDeleted?.();
  };

  const handleQueue = async () => {
    if (isQueued) {
      await supabase.from('queue').delete().eq('task_id', task.id);
      setIsQueued(false);
      window.dispatchEvent(new CustomEvent('queue-changed'));
      return;
    }

    const { data: inProgress } = await supabase
      .from('tasks').select('id').eq('team_id', activeTeamId).eq('status', 'in_progress').limit(1);

    if (!inProgress || inProgress.length === 0) {
      await supabase.from('tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', task.id);
      onDeleted?.();
    } else {
      const { data: positions } = await supabase
        .from('queue').select('position').eq('team_id', activeTeamId).order('position', { ascending: false }).limit(1);
      const maxPos = positions && positions.length > 0 ? positions[0].position : 0;
      await supabase.from('queue').insert({ task_id: task.id, team_id: activeTeamId, position: maxPos + 1 });
      setIsQueued(true);
      window.dispatchEvent(new CustomEvent('queue-changed'));
    }
  };

  const handleDelete = async () => {
    await supabase.from('tasks').delete().eq('id', task.id);
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    onDeleted?.();
  };

  const togglePerson = (name) => {
    setCompletedBy(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const handleComplete = async () => {
    if (!completedBy.length) return;
    setCompleting(true);
    await supabase.from('tasks').update({
      status: 'completed',
      completed_by: completedBy.join(', '),
      date_completed: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', task.id);

    awardTaskCompletedXp(user?.id, task.complexity);

    await supabase.from('queue').delete().eq('task_id', task.id);

    if (task.status === 'in_progress') {
      const { data: nextItems } = await supabase
        .from('queue').select('id, task_id').eq('team_id', activeTeamId).order('position').limit(1);
      if (nextItems && nextItems.length > 0) {
        const next = nextItems[0];
        await Promise.all([
          supabase.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', next.task_id),
          supabase.from('queue').delete().eq('id', next.id),
        ]);
      }
      window.dispatchEvent(new CustomEvent('queue-changed'));
    }

    setCompleting(false);
    setConfirmComplete(false);
    setCompletedBy([]);
    // Let any mounted view (e.g. the dashboard activity chart) update live.
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    onDeleted?.();
  };

  return (
    <>
      <div className={`task-card ${status.cardCls} ${featured ? 'task-card-featured' : ''}`}>

        {/* ── Main content ── */}
        <div className="task-card-content task-card-content-clickable" onClick={() => navigate(`/tasks/${task.id}`)}>

          {/* Badges */}
          <div className="task-card-badges">
            <span className={`badge ${ROI_MAP[task.roi] || ''}`}>{task.roi}</span>
            <span className="badge badge-complexity">{task.complexity}</span>
            <span className={`badge ${status.cls}`}>{status.label}</span>
            {task.png_url && (
              <button
                className="badge badge-attachment"
                onClick={(e) => { e.stopPropagation(); setImgOpen(true); }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41A2 2 0 016.59 14.59L15.78 5.4" />
                </svg>
                attachment
              </button>
            )}
            {(task.attachments || []).filter(a => (a.kind || '') !== 'image').map((a, i) => (
              <a
                key={i}
                className="badge badge-file"
                href={a.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={a.name}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41A2 2 0 016.59 14.59L15.78 5.4" />
                </svg>
                {({ pdf: 'PDF', word: 'DOC', pptx: 'PPT', ppt: 'PPT', excel: 'XLS' }[a.kind]) || 'FILE'}
              </a>
            ))}
            {linkedProject && (
              <span className="badge badge-project" title={linkedProject.title}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
                </svg>
                <span className="badge-project-text">{linkedProject.title}</span>
              </span>
            )}
          </div>

          {/* Page */}
          <div className="task-page">
            {isUrl(task.page) ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                </svg>
                <a href={task.page} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                  onClick={e => e.stopPropagation()}
                >
                  {shortenUrl(task.page)}
                </a>
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                {task.page}
              </>
            )}
          </div>

          {/* Feedback */}
          <FeedbackContent taskId={task.id} html={task.feedback} className="task-feedback" />

          {/* Footer */}
          <div className="task-card-footer">
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Noticed by <strong style={{ color: 'var(--text-muted)' }}>{task.noticed_by}</strong>
            </span>
            {task.date_received && (
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
                {format(new Date(task.date_received), 'MMM d, yyyy')}
              </span>
            )}
          </div>
        </div>

        {/* ── Action bar ── */}
        <div className="task-card-actions" style={{ position: 'relative' }}>

          {/* Complete popover */}
          {confirmComplete && (
            <div className="complete-popover" ref={popoverRef}>
              <p className="complete-popover-label">
                Completed by
                {completedBy.length > 0 && <span className="complete-popover-count">{completedBy.length}</span>}
              </p>
              <div className="complete-popover-people">
                {users.map(u => {
                  const name = `${u.first_name} ${u.last_name}`;
                  const checked = completedBy.includes(name);
                  return (
                    <label key={u.id} className={`complete-person-row ${checked ? 'complete-person-row-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePerson(name)}
                        className="complete-person-checkbox"
                      />
                      <Avatar
                          src={u.avatar_url}
                          color={u.color || '#6366f1'}
                          initials={`${u.first_name[0]}${u.last_name[0]}`}
                          size={28}
                          style={{ flexShrink: 0 }}
                        />
                      <span className="complete-person-name">{u.first_name} {u.last_name}</span>
                    </label>
                  );
                })}
              </div>
              <div className="complete-popover-actions">
                <button
                  className="task-action-btn task-action-btn-confirm"
                  onClick={handleComplete}
                  disabled={!completedBy.length || completing}
                  style={{ width: '100%' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {completing ? 'Saving...' : 'Confirm'}
                </button>
                <button
                  className="task-action-btn"
                  onClick={() => { setConfirmComplete(false); setCompletedBy([]); }}
                  style={{ width: '100%' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Assign to Project */}
          {projects.length > 0 && (
            <button
              className={`task-action-btn ${linkedProject ? 'task-action-btn-active' : ''}`}
              data-tooltip={linkedProject ? `Project: ${linkedProject.title}` : 'Assign to Project'}
              onClick={() => { setProjectPopover(v => !v); setConfirmComplete(false); setConfirmDelete(false); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
              </svg>
            </button>
          )}

          {/* Project popover */}
          {projectPopover && (
            <div className="complete-popover" ref={projectPopoverRef} style={{ minWidth: 200 }}>
              <p className="complete-popover-label">Assign to project</p>
              <div className="complete-popover-people" style={{ maxHeight: 180 }}>
                {projects.map(p => {
                  const active = task.project_id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleAssignProject(p.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '7px 10px', background: active ? 'var(--accent-glow)' : 'none',
                        border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                        color: active ? 'var(--accent)' : 'var(--text-muted)', fontSize: 13, textAlign: 'left',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-4)'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}
                    >
                      {active && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                      <span style={{ flex: 1 }}>{p.title}</span>
                    </button>
                  );
                })}
              </div>
              {linkedProject && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px' }}>
                  <button
                    onClick={() => handleAssignProject(task.project_id)}
                    style={{ width: '100%', padding: '6px 10px', background: 'none', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', color: '#f87171', fontSize: 12, textAlign: 'left' }}
                  >
                    Remove from project
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Edit */}
          <button
            className="task-action-btn"
            data-tooltip="Edit"
            onClick={() => onEdit?.(task)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>

          {/* Quick Complete */}
          {canComplete && (
            <button
              className={`task-action-btn ${confirmComplete ? 'task-action-btn-active' : ''}`}
              data-tooltip="Quick Complete"
              onClick={() => { setConfirmComplete(v => !v); setCompletedBy([]); setConfirmDelete(false); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </button>
          )}

          {/* Queue */}
          {canQueue && (
            <button
              className={`task-action-btn ${isQueued ? 'task-action-btn-active' : ''}`}
              data-tooltip={isQueued ? 'Remove from Queue' : 'Add to Queue'}
              onClick={handleQueue}
            >
              {isQueued ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              )}
            </button>
          )}

          {/* Delete */}
          {!confirmDelete ? (
            <button
              className="task-action-btn task-action-btn-danger"
              data-tooltip="Delete"
              onClick={() => { setConfirmDelete(true); setConfirmComplete(false); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6 M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          ) : (
            <>
              <button
                className="task-action-btn task-action-btn-confirm"
                data-tooltip="Confirm"
                onClick={handleDelete}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                className="task-action-btn"
                data-tooltip="Cancel"
                onClick={() => setConfirmDelete(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}

        </div>
      </div>

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
