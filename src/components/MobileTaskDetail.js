import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isBefore, parseISO, startOfToday } from 'date-fns';
import { subtaskProgress } from '../lib/subtasks';
import Avatar from './Avatar';
import ModalPortal from './ModalPortal';
import FeedbackContent from './FeedbackContent';
import TaskSubtasks from './TaskSubtasks';
import TaskAttachments from './TaskAttachments';
import { CompleteSheet, STATUS_META, isUrl, titleOf } from './MobileTaskList';
import './MobileTaskDetail.css';

// ══════════════════════════════════════════════════════════════
// Mobile task detail
// --------------------------------------------------------------
// A reading screen, not a disabled form. The first pass at this simply
// disabled the desktop edit form on phones, which technically enforced
// read-only but still looked like a form you couldn't use: a dead upload
// dropzone eating the first screenful, a greyed <select> for status, the
// description trapped in a rich-text editor box.
//
// So this is laid out for the two things a companion is actually for —
// reading what the task is, and ticking its subtasks off — with everything
// ordered by how likely you are to want it and the primary action pinned
// where a thumb already rests.
// ══════════════════════════════════════════════════════════════

const ROI_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function MetaRow({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="mdetail-meta-row">
      <span className="mdetail-meta-label">{label}</span>
      <span className="mdetail-meta-value">{children}</span>
    </div>
  );
}

export default function MobileTaskDetail({ task, users = [], projects = [], onChanged }) {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);
  const [zoom, setZoom] = useState(false);

  const status = STATUS_META[task.status] || STATUS_META.open;
  const { done, total } = subtaskProgress(task.subtasks);
  const assignee = users.find(u => u.id === task.assignee_id);
  const project = projects.find(p => p.id === task.project_id);
  const overdue = task.due_date
    && task.status !== 'completed'
    && isBefore(parseISO(task.due_date), startOfToday());
  const isDone = task.status === 'completed';
  const files = (task.attachments || []).filter(a => (a.kind || '') !== 'image');

  return (
    <div className="mdetail" style={{ '--row-color': status.color }}>

      {/* Back + status stay put while the body scrolls, so you can always
          leave without scrolling back to the top. */}
      <header className="mdetail-bar">
        <button type="button" className="mdetail-back" onClick={() => navigate(-1)} aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="mdetail-status">
          <span className="mdetail-status-dot" />
          {status.label}
        </span>
      </header>

      <h1 className="mdetail-title">{titleOf(task)}</h1>

      {isUrl(task.page) && (
        <a className="mdetail-link" href={task.page} target="_blank" rel="noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" />
          </svg>
          Open page
        </a>
      )}

      {/* Subtasks first — the one thing you're here to do. */}
      {total > 0 && (
        <section className="mdetail-section">
          <h2 className="mdetail-section-head">
            Checklist
            <span className="mdetail-section-count">{done}/{total}</span>
          </h2>
          <div className="mdetail-subtasks">
            <TaskSubtasks taskId={task.id} subtasks={task.subtasks} onChanged={onChanged} defaultExpanded />
          </div>
        </section>
      )}

      {task.feedback && (
        <section className="mdetail-section">
          <h2 className="mdetail-section-head">Details</h2>
          <FeedbackContent taskId={task.id} html={task.feedback} className="mdetail-feedback" onSaved={onChanged} />
        </section>
      )}

      {/* Only when there IS one — the desktop's upload dropzone is the single
          biggest waste of a phone screen on a task you can't edit anyway. */}
      {task.png_url && (
        <section className="mdetail-section">
          <h2 className="mdetail-section-head">Screenshot</h2>
          <button type="button" className="mdetail-shot" onClick={() => setZoom(true)}>
            <img src={task.png_url} alt="Task screenshot" />
          </button>
        </section>
      )}

      {files.length > 0 && (
        <section className="mdetail-section">
          <h2 className="mdetail-section-head">Attachments</h2>
          <TaskAttachments attachments={files} />
        </section>
      )}

      <section className="mdetail-section">
        <h2 className="mdetail-section-head">Info</h2>
        <div className="mdetail-meta">
          <MetaRow label="ROI">{ROI_LABEL[task.roi] || task.roi}</MetaRow>
          <MetaRow label="Complexity">{task.complexity}</MetaRow>
          {project && <MetaRow label="Project">{project.title}</MetaRow>}
          {assignee && (
            <MetaRow label="Assignee">
              <span className="mdetail-person">
                <Avatar
                  src={assignee.avatar_url}
                  color={assignee.color || '#6366f1'}
                  initials={`${assignee.first_name[0] || ''}${assignee.last_name[0] || ''}`}
                  size={22}
                />
                {assignee.first_name} {assignee.last_name}
              </span>
            </MetaRow>
          )}
          {task.due_date && (
            <MetaRow label="Due">
              <span className={overdue ? 'mdetail-overdue' : undefined}>
                {format(parseISO(task.due_date), 'MMM d, yyyy')}{overdue ? ' — overdue' : ''}
              </span>
            </MetaRow>
          )}
          <MetaRow label="Noticed by">{task.noticed_by}</MetaRow>
          {(task.date_received || task.created_at) && (
            <MetaRow label="Posted">
              {format(new Date(task.date_received || task.created_at), 'MMM d, yyyy')}
            </MetaRow>
          )}
          {task.date_completed && (
            <MetaRow label="Completed">{format(new Date(task.date_completed), 'MMM d, yyyy')}</MetaRow>
          )}
          <MetaRow label="Completed by">{task.completed_by}</MetaRow>
        </div>
      </section>

      {/* Pinned above the dock: the one action this screen offers. */}
      {!isDone && (
        <div className="mdetail-action">
          <button type="button" className="mdetail-complete" onClick={() => setSheet(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark complete
          </button>
        </div>
      )}

      {sheet && (
        <CompleteSheet
          task={task}
          users={users}
          onClose={() => setSheet(false)}
          onDone={() => { onChanged?.(); navigate(-1); }}
        />
      )}

      {zoom && (
        <ModalPortal>
          <div className="mdetail-zoom" onClick={() => setZoom(false)}>
            <img src={task.png_url} alt="Task screenshot" />
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
