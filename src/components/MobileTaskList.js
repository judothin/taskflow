import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isBefore, parseISO, startOfToday } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { subtaskProgress } from '../lib/subtasks';
import { completeTask } from '../lib/completeTask';
import Avatar from './Avatar';
import TaskSubtasks from './TaskSubtasks';
import useMountTransition from '../lib/useMountTransition';
import ModalPortal from './ModalPortal';
import './MobileTaskList.css';

// ══════════════════════════════════════════════════════════════
// Mobile task list
// --------------------------------------------------------------
// The desktop TaskCard shows everything at once: badge wall, rich-text
// feedback, attachments, an inline subtask grid, a six-button action rail.
// That's right for a wide screen you're working from and wrong for a phone
// you're glancing at — it turns into a wall of 11px text.
//
// So the phone gets its own row instead of a squeezed card, following what
// every list-shaped task app settles on: one line of title, one line of
// meta, a big circle to tick it off, and everything else deferred to the
// detail screen. Two targets per row, both comfortably past 44px: the circle
// completes, the rest opens.
// ══════════════════════════════════════════════════════════════

export const STATUS_META = {
  critical:    { label: 'Critical',    color: 'var(--st-critical)' },
  open:        { label: 'Open',        color: 'var(--st-open)' },
  in_progress: { label: 'In Progress', color: 'var(--st-inprogress)' },
  on_hold:     { label: 'On Hold',     color: 'var(--st-onhold)' },
  completed:   { label: 'Completed',   color: 'var(--st-completed)' },
};

// Feedback is stored as rich-text HTML. A row wants a plain, collapsed
// snippet of it — tags out, runs of whitespace down to single spaces.
const strip = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export const isUrl = (s) => { try { return Boolean(new URL(s)) && /^https?:\/\//i.test(s); } catch { return false; } };
export const titleOf = (task) => {
  const page = task.page || 'Untitled';
  if (!isUrl(page)) return page;
  // A bare URL is unreadable at a glance — show the last meaningful segment.
  try {
    const u = new URL(page);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg ? seg.replace(/[-_]/g, ' ') : u.hostname;
  } catch { return page; }
};

// ── Bottom sheet: who finished it ─────────────────────────────
// The task table wants `completed_by` names, so completion can't be a single
// silent tap. It's still one tap in the common case: you're pre-selected, so
// the sheet opens ready to confirm.
export function CompleteSheet({ task, users, onClose, onDone }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const myName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
  const [picked, setPicked] = useState(() => (myName ? [myName] : []));
  const [saving, setSaving] = useState(false);

  const toggle = (name) =>
    setPicked(p => (p.includes(name) ? p.filter(n => n !== name) : [...p, name]));

  const confirm = async () => {
    if (!picked.length || saving) return;
    setSaving(true);
    await completeTask({ task, completedBy: picked, userId: user?.id, teamId: activeTeamId });
    setSaving(false);
    onDone?.();
    onClose();
  };

  return (
    <ModalPortal>
      <div className="msheet-overlay" onClick={onClose}>
        <div className="msheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Mark complete">
          <span className="msheet-grabber" aria-hidden="true" />

          <h2 className="msheet-title">Mark complete</h2>
          <p className="msheet-task">{titleOf(task)}</p>

          <div className="msheet-label">Completed by</div>
          <div className="msheet-people">
            {users.map(u => {
              const name = `${u.first_name} ${u.last_name}`;
              const on = picked.includes(name);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`msheet-person ${on ? 'msheet-person-on' : ''}`}
                  onClick={() => toggle(name)}
                  aria-pressed={on}
                >
                  <Avatar
                    src={u.avatar_url}
                    color={u.color || '#6366f1'}
                    initials={`${u.first_name[0] || ''}${u.last_name[0] || ''}`}
                    size={32}
                  />
                  <span className="msheet-person-name">{u.first_name} {u.last_name}</span>
                  <span className={`msheet-tick ${on ? 'msheet-tick-on' : ''}`}>
                    {on && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="msheet-actions">
            <button type="button" className="msheet-confirm" disabled={!picked.length || saving} onClick={confirm}>
              {saving ? 'Saving…' : 'Complete'}
            </button>
            <button type="button" className="msheet-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── One row ───────────────────────────────────────────────────
function MobileTaskRow({ task, users, onChanged, index = 0 }) {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[task.status] || STATUS_META.open;
  const { done, total } = subtaskProgress(task.subtasks);
  const assignee = users.find(u => u.id === task.assignee_id);
  const detail = strip(task.feedback);
  const overdue = task.due_date
    && task.status !== 'completed'
    && isBefore(parseISO(task.due_date), startOfToday());

  // Tapping a task with a checklist drops it open in place — ticking items off
  // is the companion's whole job, and making that a page navigation each time
  // means a round trip per box. A task with no checklist has nothing to drop
  // down, so it opens the full view instead.
  const expandable = total > 0;
  // Kept mounted through the close so the drawer can animate shut as well as
  // open — see useMountTransition.
  const drawer = useMountTransition(expandable && open, 240);
  const onRowTap = () => {
    if (expandable) setOpen(v => !v);
    else navigate(`/tasks/${task.id}`);
  };

  return (
    <>
      <div
        className={`mtask-row ${open ? 'mtask-row-open' : ''}`}
        style={{ '--row-color': meta.color, '--i': index }}
      >
        <button
          type="button"
          className="mtask-check"
          onClick={() => setSheet(true)}
          aria-label={`Mark ${titleOf(task)} complete`}
        >
          <span className="mtask-circle" />
        </button>

        {/* Everything but the check circle is ONE target. The avatar and the
            chevron sat outside the button before, which made the chevron — the
            obvious thing to tap for a dropdown — a dead zone, so the first tap
            did nothing and the second one (on the title) worked. */}
        <button
          type="button"
          className="mtask-main"
          onClick={onRowTap}
          aria-expanded={expandable ? open : undefined}
        >
          <span className="mtask-main-text">
            <span className="mtask-title">{titleOf(task)}</span>
            {detail && <span className="mtask-detail">{detail}</span>}
            <span className="mtask-meta">
              <span className="mtask-status">
                <span className="mtask-dot" />
                {meta.label}
              </span>
              {total > 0 && (
                <span className="mtask-sub">{done}/{total}</span>
              )}
              {task.due_date && (
                <span className={`mtask-due ${overdue ? 'mtask-due-over' : ''}`}>
                  {format(parseISO(task.due_date), 'MMM d')}
                </span>
              )}
            </span>
          </span>

          {assignee && (
            <Avatar
              src={assignee.avatar_url}
              color={assignee.color || '#6366f1'}
              initials={`${assignee.first_name[0] || ''}${assignee.last_name[0] || ''}`}
              size={28}
            />
          )}

          {expandable && (
            <span className={`mtask-chevron ${open ? 'mtask-chevron-open' : ''}`} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          )}
        </button>
      </div>

      {drawer.mounted && (
        <div className={`mtask-drawer ${drawer.shown ? 'mtask-drawer-open' : ''}`}>
          <div className="mtask-drawer-inner">
            <TaskSubtasks
              taskId={task.id}
              subtasks={task.subtasks}
              onChanged={onChanged}
              defaultExpanded
            />
            <button type="button" className="mtask-open" onClick={() => navigate(`/tasks/${task.id}`)}>
              Open full view
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <CompleteSheet
          task={task}
          users={users}
          onClose={() => setSheet(false)}
          onDone={onChanged}
        />
      )}
    </>
  );
}

// ── The list ──────────────────────────────────────────────────
// `groups` is [{ key, label, tasks }] when the caller wants headers (Focus
// splits in-progress from up-next); plain `tasks` renders one flat list.
export default function MobileTaskList({ tasks, groups, users = [], onChanged, empty }) {
  const sections = groups || [{ key: 'all', label: null, tasks: tasks || [] }];
  const count = sections.reduce((n, s) => n + s.tasks.length, 0);

  if (!count) {
    return <div className="mtask-empty">{empty || 'Nothing here.'}</div>;
  }

  return (
    <div className="mtask-list">
      {sections.filter(s => s.tasks.length).map(section => (
        <section key={section.key} className="mtask-section">
          {section.label && (
            <h3 className="mtask-section-head">
              {section.label}
              <span className="mtask-section-count">{section.tasks.length}</span>
            </h3>
          )}
          <div className="mtask-rows">
            {section.tasks.map((task, i) => (
              <MobileTaskRow key={task.id} task={task} users={users} onChanged={onChanged} index={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
