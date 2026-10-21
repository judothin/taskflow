import React, { useMemo } from 'react';
import { taskTitle, pageLabel } from '../lib/taskText';
import { subtaskProgress } from '../lib/subtasks';
import { openTask, openTaskMenu } from '../lib/events';
import { Avatar, Empty, Icon, StatusLabel, SkeletonRows, shortDate, cap, fullName, STATUS_LABEL } from '../ui';
import './TaskTable.css';

const STATUS_ORDER = ['critical', 'in_progress', 'open', 'on_hold', 'completed'];
const ROI_ORDER = ['critical', 'high', 'medium', 'low'];

export const GROUPS = [
  { value: 'status', label: 'Status' },
  { value: 'roi', label: 'Priority' },
  { value: 'page', label: 'Page' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'None' },
];

// Every column the table knows how to draw. Pages pick a subset, in order.
const COLUMNS = {
  task: { label: 'Task', width: 'minmax(260px, 3fr)' },
  page: { label: 'Page', width: 'minmax(120px, 1.25fr)' },
  status: { label: 'Status', width: '130px' },
  priority: { label: 'Priority', width: '100px' },
  assignee: { label: 'Assignee', width: 'minmax(120px, 1fr)' },
  noticed: { label: 'Noticed by', width: 'minmax(120px, 1fr)' },
  due: { label: 'Due', width: '92px' },
  posted: { label: 'Posted', width: '86px' },
};

function Cell({ col, t, users }) {
  switch (col) {
    case 'task': {
      const { done, total } = subtaskProgress(t.subtasks);
      return (
        <div className="table-cell tt-task">
          <span className="table-title tt-title">{taskTitle(t)}</span>
          {total > 0 && <span className={`tt-sub-count mono ${done === total ? 'is-done' : ''}`}>{done}/{total}</span>}
          {(t.attachments?.length > 0 || t.png_url) && <Icon name="paperclip" size={13} className="t-4" />}
        </div>
      );
    }
    case 'page': return <div className="table-cell"><span className="truncate t-2">{pageLabel(t.page) || <span className="t-4">—</span>}</span></div>;
    case 'status': return <div className="table-cell"><StatusLabel status={t.status} /></div>;
    case 'priority': return <div className="table-cell"><span className={`prio prio-${t.roi}`}>{cap(t.roi || 'medium')}</span></div>;
    case 'assignee': {
      const u = users.find(x => x.id === t.assignee_id);
      return <div className="table-cell">{u ? <span className="person"><Avatar person={u} size={22} /><span className="truncate">{fullName(u)}</span></span> : <span className="t-4">—</span>}</div>;
    }
    case 'noticed': return <div className="table-cell"><span className="truncate t-2">{t.noticed_by || '—'}</span></div>;
    case 'due': {
      if (!t.due_date) return <div className="table-cell"><span className="t-4">—</span></div>;
      const late = t.status !== 'completed' && new Date(`${t.due_date}T23:59:59`) < new Date();
      return <div className="table-cell mono"><span className={late ? 't-bad' : ''}>{shortDate(`${t.due_date}T12:00:00`)}</span></div>;
    }
    case 'posted': return <div className="table-cell mono">{shortDate(t.date_received || t.created_at)}</div>;
    default: return null;
  }
}

function groupKey(t, by, users) {
  if (by === 'status') return t.status || 'open';
  if (by === 'roi') return t.roi || 'medium';
  if (by === 'page') return pageLabel(t.page) || 'No page';
  if (by === 'assignee') {
    const u = users.find(x => x.id === t.assignee_id);
    return u ? fullName(u) : 'Unassigned';
  }
  return 'all';
}

/**
 * The task list used by Dashboard and Tasks. Rows open the task sheet.
 *   columns  — keys of COLUMNS, in order
 *   groupBy  — 'status' | 'roi' | 'page' | 'assignee' | 'none'
 *   select   — { ids:Set, toggle(id) } to show checkboxes
 */
export default function TaskTable({
  tasks, users = [], columns = ['task', 'page', 'priority', 'noticed', 'posted'],
  groupBy = 'status', loading, empty = 'No tasks here.', select, onContextMenu,
}) {
  const cols = useMemo(() => columns.filter(c => COLUMNS[c]), [columns]);
  const template = (select ? '22px ' : '') + cols.map(c => COLUMNS[c].width).join(' ');

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', tasks }];
    const map = new Map();
    tasks.forEach(t => {
      const k = groupKey(t, groupBy, users);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    });
    const order = groupBy === 'status' ? STATUS_ORDER : groupBy === 'roi' ? ROI_ORDER : null;
    const keys = [...map.keys()].sort((a, b) => {
      if (order) return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99);
      if (a === 'Unassigned' || a === 'No page') return 1;
      if (b === 'Unassigned' || b === 'No page') return -1;
      return a.localeCompare(b);
    });
    return keys.map(k => ({ key: k, tasks: map.get(k) }));
  }, [tasks, groupBy, users]);

  const groupLabel = (k) => {
    if (groupBy === 'status') return STATUS_LABEL[k] || cap(k);
    if (groupBy === 'roi') return cap(k);
    return k;
  };

  return (
    <div className="table tt" style={{ '--cols': template }}>
      <div className="table-head">
        {select && <span />}
        {cols.map(c => <span key={c}>{COLUMNS[c].label}</span>)}
      </div>
      {loading ? (
        <SkeletonRows rows={6} />
      ) : !tasks.length ? (
        <Empty icon="tasks" title={empty} />
      ) : groups.map(g => (
        <section key={g.key} className="tt-group">
          {groupBy !== 'none' && (
            <div className="table-group anim-rise">
              {groupBy === 'status' && <span className={`dot dot-${g.key}`} />}
              {groupBy === 'roi' && <span className={`dot ${g.key === 'critical' || g.key === 'high' ? 'dot-critical' : ''}`} />}
              {groupBy === 'assignee' && <Icon name="user" size={14} className="table-group-icon" />}
              {groupBy === 'page' && <Icon name="link" size={14} className="table-group-icon" />}
              <span>{groupLabel(g.key)}</span>
              <span key={g.tasks.length} className="count bump">{g.tasks.length}</span>
            </div>
          )}
          <div className="stagger">
            {g.tasks.map(t => (
              <div
                key={t.id}
                className={`table-row ${select?.ids.has(t.id) ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => (select ? select.toggle(t.id) : openTask(t))}
                onKeyDown={(e) => { if (e.key === 'Enter') openTask(t); }}
                onContextMenu={(e) => (onContextMenu ? onContextMenu(e, t) : openTaskMenu(e, t))}
              >
                {select && (
                  <input
                    type="checkbox" className="check" checked={select.ids.has(t.id)}
                    onChange={() => select.toggle(t.id)} onClick={(e) => e.stopPropagation()} aria-label="Select task"
                  />
                )}
                {cols.map(c => <Cell key={c} col={c} t={t} users={users} />)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
