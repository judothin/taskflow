import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { awardTaskCompletedXp } from '../lib/xp';
import Avatar from './Avatar';
import FeedbackContent from './FeedbackContent';
import TaskSubtasks from './TaskSubtasks';
import AnimatedPopover from './AnimatedPopover';
import DatePicker from './DatePicker';
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

// Inline quick-edit option lists (statuses match TaskForm's allowed set).
const ROI_OPTIONS    = ['critical', 'high', 'medium', 'low'];
const STATUS_OPTIONS = ['open', 'in_progress', 'on_hold', 'completed'];

export default function TaskCard({ task, onEdit, onDeleted, featured = false, users = [], projects = [], selectMode = false, selected = false, onToggleSelect }) {
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
  const [assigneePopover, setAssigneePopover] = useState(false);
  const [roiEdit, setRoiEdit]             = useState(false);
  const [statusEdit, setStatusEdit]       = useState(false);
  const [editingPage, setEditingPage]     = useState(false);
  const [pageDraft, setPageDraft]         = useState('');
  const popoverRef                        = useRef(null);
  const projectPopoverRef                 = useRef(null);
  const assigneePopoverRef                = useRef(null);
  const roiRef                            = useRef(null);
  const statusRef                         = useRef(null);
  const cancelPageRef                     = useRef(false);

  const status          = STATUS_MAP[task.status] || STATUS_MAP.open;
  const canQueue        = task.status !== 'in_progress' && task.status !== 'completed';
  const canComplete     = task.status !== 'completed';
  const linkedProject   = projects.find(p => p.id === task.project_id) || null;
  const assignee        = users.find(u => u.id === task.assignee_id) || null;

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

  useEffect(() => {
    if (!assigneePopover) return;
    const handler = (e) => {
      if (assigneePopoverRef.current && !assigneePopoverRef.current.contains(e.target))
        setAssigneePopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [assigneePopover]);

  // Close the ROI / status quick-edit popovers on an outside click.
  useEffect(() => {
    if (!roiEdit && !statusEdit) return;
    const handler = (e) => {
      if (roiRef.current?.contains(e.target)) return;
      if (statusRef.current?.contains(e.target)) return;
      setRoiEdit(false);
      setStatusEdit(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [roiEdit, statusEdit]);

  // Shared inline-edit writer: patch the task, notify listeners, refresh the list.
  const patchTask = async (patch) => {
    await supabase.from('tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', task.id);
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    onDeleted?.();
  };

  const handleAssignProject = async (projectId) => {
    const newId = task.project_id === projectId ? null : projectId;
    await supabase.from('tasks').update({ project_id: newId, updated_at: new Date().toISOString() }).eq('id', task.id);
    setProjectPopover(false);
    onDeleted?.();
  };

  const handleAssignPerson = async (userId) => {
    const newId = task.assignee_id === userId ? null : userId;
    await supabase.from('tasks').update({ assignee_id: newId, updated_at: new Date().toISOString() }).eq('id', task.id);
    setAssigneePopover(false);
    onDeleted?.();
  };

  const handleSetDueDate = (dateStr) => patchTask({ due_date: dateStr });

  const chooseRoi = (roi) => { setRoiEdit(false); if (roi !== task.roi) patchTask({ roi }); };

  const chooseStatus = (s) => {
    setStatusEdit(false);
    if (s === task.status) return;
    // Completing needs the "completed by" + XP flow — reuse the complete popover.
    if (s === 'completed') { setConfirmComplete(true); return; }
    const patch = { status: s };
    // Leaving a completed state clears its completion metadata.
    if (task.status === 'completed') { patch.date_completed = null; patch.completed_by = null; }
    patchTask(patch);
  };

  const savePage = () => {
    if (cancelPageRef.current) { cancelPageRef.current = false; setEditingPage(false); return; }
    setEditingPage(false);
    const v = pageDraft.trim();
    if (v && v !== task.page) patchTask({ page: v });
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

    awardTaskCompletedXp(user?.id, task.complexity, { roi: task.roi, status: task.status, wasQueued: isQueued || task.status === 'in_progress' });

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
      <div className={`task-card ${status.cardCls} ${featured ? 'task-card-featured' : ''} ${selectMode ? 'task-card-select-mode' : ''} ${selected ? 'task-card-selected' : ''}`}>

        {/* Select overlay — covers the whole card while in select mode so a
            click anywhere toggles selection instead of opening the task. */}
        {selectMode && (
          <button
            type="button"
            className="task-select-overlay"
            onClick={() => onToggleSelect?.(task.id)}
            aria-pressed={selected}
            aria-label={selected ? 'Deselect task' : 'Select task'}
          >
            <span className={`task-select-box ${selected ? 'task-select-box-checked' : ''}`}>
              {selected && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
          </button>
        )}

        {/* ── Main content ── */}
        <div className={`task-card-content ${selectMode ? '' : 'task-card-content-clickable'}`} onClick={selectMode ? undefined : () => navigate(`/tasks/${task.id}`)}>

          {/* Badges */}
          <div className="task-card-badges">
            {/* ROI — click to change inline */}
            <span className="badge-edit-wrap" ref={roiRef}>
              <button
                className={`badge ${ROI_MAP[task.roi] || ''} badge-editable`}
                onClick={(e) => { e.stopPropagation(); setRoiEdit(v => !v); setStatusEdit(false); }}
                title="Change ROI"
              >
                {task.roi}
              </button>
              <AnimatedPopover open={roiEdit} className="card-edit-popover" onClick={(e) => e.stopPropagation()}>
                {ROI_OPTIONS.map(r => (
                  <button key={r} className={`card-edit-option ${r === task.roi ? 'card-edit-option-active' : ''}`} onClick={() => chooseRoi(r)}>
                    <span className={`badge ${ROI_MAP[r]}`}>{r}</span>
                  </button>
                ))}
              </AnimatedPopover>
            </span>

            <span className="badge badge-complexity">{task.complexity}</span>

            {/* Status — click to change inline */}
            <span className="badge-edit-wrap" ref={statusRef}>
              <button
                className={`badge ${status.cls} badge-editable`}
                onClick={(e) => { e.stopPropagation(); setStatusEdit(v => !v); setRoiEdit(false); }}
                title="Change status"
              >
                {status.label}
              </button>
              <AnimatedPopover open={statusEdit} className="card-edit-popover" onClick={(e) => e.stopPropagation()}>
                {STATUS_OPTIONS.map(s => (
                  <button key={s} className={`card-edit-option ${s === task.status ? 'card-edit-option-active' : ''}`} onClick={() => chooseStatus(s)}>
                    <span className={`badge ${STATUS_MAP[s].cls}`}>{STATUS_MAP[s].label}</span>
                  </button>
                ))}
              </AnimatedPopover>
            </span>
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
            {/* Project — click to change inline (dropdown anchored here) */}
            {projects.length > 0 && (
              <span className="badge-edit-wrap" ref={projectPopoverRef}>
                {linkedProject ? (
                  <button
                    className="badge badge-project badge-editable"
                    title={`Project: ${linkedProject.title} — click to change`}
                    onClick={(e) => { e.stopPropagation(); setProjectPopover(v => !v); setRoiEdit(false); setStatusEdit(false); }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
                    </svg>
                    <span className="badge-project-text">{linkedProject.title}</span>
                  </button>
                ) : (
                  <button
                    className="badge badge-add-project"
                    title="Assign to project"
                    onClick={(e) => { e.stopPropagation(); setProjectPopover(v => !v); setRoiEdit(false); setStatusEdit(false); }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
                    </svg>
                    Project
                  </button>
                )}

                <AnimatedPopover open={projectPopover} className="card-edit-popover card-edit-popover-wide" onClick={(e) => e.stopPropagation()}>
                  <p className="card-edit-popover-label">Assign to project</p>
                  <div className="card-edit-popover-scroll">
                    {projects.map(p => {
                      const active = task.project_id === p.id;
                      return (
                        <button key={p.id} className={`card-edit-project-option ${active ? 'card-edit-project-option-active' : ''}`} onClick={() => handleAssignProject(p.id)}>
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
                    <div className="card-edit-project-remove-wrap">
                      <button className="card-edit-project-remove" onClick={() => handleAssignProject(task.project_id)}>
                        Remove from project
                      </button>
                    </div>
                  )}
                </AnimatedPopover>
              </span>
            )}

            {/* Assignee — click to change inline (optional team member) */}
            {users.length > 0 && (
              <span className="badge-edit-wrap" ref={assigneePopoverRef}>
                {assignee ? (
                  <button
                    className="badge badge-assignee badge-editable"
                    title={`Assigned to ${assignee.first_name} ${assignee.last_name} — click to change`}
                    onClick={(e) => { e.stopPropagation(); setAssigneePopover(v => !v); setRoiEdit(false); setStatusEdit(false); }}
                  >
                    <Avatar
                      src={assignee.avatar_url}
                      color={assignee.color || '#6366f1'}
                      initials={`${assignee.first_name[0]}${assignee.last_name[0]}`}
                      size={14}
                    />
                    <span className="badge-project-text">{assignee.first_name} {assignee.last_name}</span>
                  </button>
                ) : (
                  <button
                    className="badge badge-add-project"
                    title="Assign a team member"
                    onClick={(e) => { e.stopPropagation(); setAssigneePopover(v => !v); setRoiEdit(false); setStatusEdit(false); }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                    Assignee
                  </button>
                )}

                <AnimatedPopover open={assigneePopover} className="card-edit-popover card-edit-popover-wide" onClick={(e) => e.stopPropagation()}>
                  <p className="card-edit-popover-label">Assign to</p>
                  <div className="card-edit-popover-scroll">
                    {users.map(u => {
                      const active = task.assignee_id === u.id;
                      return (
                        <button key={u.id} className={`card-edit-project-option ${active ? 'card-edit-project-option-active' : ''}`} onClick={() => handleAssignPerson(u.id)}>
                          <Avatar
                            src={u.avatar_url}
                            color={u.color || '#6366f1'}
                            initials={`${u.first_name[0]}${u.last_name[0]}`}
                            size={20}
                          />
                          <span style={{ flex: 1 }}>{u.first_name} {u.last_name}</span>
                          {active && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {assignee && (
                    <div className="card-edit-project-remove-wrap">
                      <button className="card-edit-project-remove" onClick={() => handleAssignPerson(task.assignee_id)}>
                        Unassign
                      </button>
                    </div>
                  )}
                </AnimatedPopover>
              </span>
            )}
          </div>

          {/* Page — click the pencil to edit inline */}
          <div className="task-page">
            {editingPage ? (
              <input
                className="task-page-input"
                autoFocus
                value={pageDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setPageDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') { cancelPageRef.current = true; e.currentTarget.blur(); }
                }}
                onBlur={savePage}
                placeholder="Page name or URL"
              />
            ) : (
              <>
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
                <button
                  className="task-page-edit-btn"
                  title="Edit page"
                  onClick={(e) => { e.stopPropagation(); setPageDraft(task.page || ''); setEditingPage(true); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Feedback */}
          <FeedbackContent taskId={task.id} html={task.feedback} className="task-feedback" />

          {/* Subtasks progress */}
          <TaskSubtasks taskId={task.id} subtasks={task.subtasks} onChanged={onDeleted} defaultExpanded />

          {/* Footer */}
          <div className="task-card-footer">
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Noticed by <strong style={{ color: 'var(--text-muted)' }}>{task.noticed_by}</strong>
            </span>
            <DatePicker
              variant="badge"
              value={task.due_date}
              completed={task.status === 'completed'}
              placeholder="Due date"
              onChange={handleSetDueDate}
            />
          </div>
        </div>

        {/* ── Action bar ── (hidden in select mode) */}
        {!selectMode && (
        <div className="task-card-actions" style={{ position: 'relative' }}>

          {/* Complete popover */}
          <AnimatedPopover open={confirmComplete} className="complete-popover" ref={popoverRef}>
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
          </AnimatedPopover>

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
        )}
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
