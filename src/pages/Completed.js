import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { format, isSameDay, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { openTask, tasksChanged, TASKS_CHANGED } from '../lib/events';
import { taskTitle, taskPreview, pageLabel, isUrl } from '../lib/taskText';
import { TopBarPortal } from '../context/HeaderActionsContext';
import useIsPhone from '../lib/useIsPhone';
import CompletionCalendar from '../components/CompletionCalendar';
import {
  Icon, Menu, MenuItem, MenuSep, useMenu, ConfirmDialog, Lightbox, toast,
  Avatar, Empty, SearchInput, SkeletonRows, shortDate, fullName, cap,
} from '../ui';
import './Completed.css';

// ══════════════════════════════════════════════════════════════
// Completed — every finished task, filtered by day (calendar) and by who
// completed it. Completions are credited by name: tasks.completed_by is the
// comma-separated list of names picked when the task was marked done.
// ══════════════════════════════════════════════════════════════

const PAGE_SIZE = 100;
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'page', label: 'Page A–Z' },
];

const namesOf = (t) => String(t.completed_by || '').split(',').map(s => s.trim()).filter(Boolean);
async function fetchCompleted(teamId) {
  // Page through so a big team isn't silently cut off at 1000 rows.
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('team_id', teamId).eq('status', 'completed')
      .order('date_completed', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function Completed() {
  const location = useLocation();
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();

  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [person, setPerson] = useState('all');
  const [selectedDate, setSelectedDate] = useState(() =>
    (location.state?.date ? parseISO(location.state.date) : new Date()));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [shot, setShot] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const sortMenu = useMenu();

  const load = useCallback(async (quiet) => {
    if (!activeTeamId) { setTasks([]); setUsers([]); setLoading(false); return; }
    if (!quiet) setLoading(true);
    try {
      const [list, members] = await Promise.all([fetchCompleted(activeTeamId), fetchTeamMembers(activeTeamId)]);
      setTasks(list);
      setUsers(members || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load completed tasks.');
    }
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { load(false); }, [load]);
  // App-wide forms (task sheet, Quick Log, scans) announce their saves.
  useEffect(() => {
    const h = () => load(true);
    window.addEventListener(TASKS_CHANGED, h);
    return () => window.removeEventListener(TASKS_CHANGED, h);
  }, [load]);

  // Everyone credited on a completion, with their totals (all dates).
  const people = useMemo(() => {
    const counts = new Map();
    for (const t of tasks) for (const n of new Set(namesOf(t))) counts.set(n, (counts.get(n) || 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({
        name, count,
        user: users.find(u => fullName(u).toLowerCase() === name.toLowerCase()) || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, users]);

  const personTasks = useMemo(
    () => (person === 'all' ? tasks : tasks.filter(t => namesOf(t).includes(person))),
    [tasks, person],
  );

  // Lower-cased search text per task, built once per load (HTML parsing
  // isn't free across a thousand rows).
  const haystack = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      m.set(t.id, [taskTitle(t), taskPreview(t, 2000), t.page, t.noticed_by, t.completed_by]
        .map(v => String(v || '')).join(' • ').toLowerCase());
    }
    return m;
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = personTasks.filter(t => {
      if (selectedDate && !(t.date_completed && isSameDay(new Date(t.date_completed), selectedDate))) return false;
      return !q || (haystack.get(t.id) || '').includes(q);
    });
    const time = (t) => new Date(t.date_completed || 0).getTime();
    if (sort === 'oldest') list.sort((a, b) => time(a) - time(b));
    else if (sort === 'page') list.sort((a, b) => String(a.page || '').localeCompare(String(b.page || '')) || time(b) - time(a));
    else list.sort((a, b) => time(b) - time(a));
    return list;
  }, [personTasks, selectedDate, search, sort, haystack]);

  const filterKey = `${person}|${selectedDate ? format(selectedDate, 'yyyy-MM-dd') : 'all'}|${search}|${sort}`;
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey]);

  // ── Actions ──
  const reopen = async (task) => {
    const prev = { status: task.status, date_completed: task.date_completed, completed_by: task.completed_by };
    const { error: err } = await supabase.from('tasks')
      .update({ status: 'open', date_completed: null, completed_by: null, updated_at: new Date().toISOString() })
      .eq('id', task.id);
    if (err) { toast(err.message, { icon: 'alert' }); return; }
    tasksChanged();
    toast('Task reopened', {
      action: {
        label: 'Undo',
        onClick: async () => {
          await supabase.from('tasks').update({ ...prev, updated_at: new Date().toISOString() }).eq('id', task.id);
          tasksChanged();
        },
      },
    });
  };

  const remove = async () => {
    if (!confirmDel) return;
    setBusy(true);
    const { error: err } = await supabase.from('tasks').delete().eq('id', confirmDel.id);
    setBusy(false);
    setConfirmDel(null);
    if (err) { toast(err.message, { icon: 'alert' }); return; }
    toast('Task deleted');
    tasksChanged();
  };

  const pickDate = (d) => setSelectedDate(prev => (prev && isSameDay(prev, d) ? null : d));
  const selectedPerson = people.find(p => p.name === person);
  const eyebrow = `${selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'All dates'} · ${person === 'all' ? 'All team members' : person}`;
  const sortLabel = SORTS.find(s => s.value === sort)?.label;
  const filtering = !!(search || person !== 'all' || selectedDate);

  const sortButton = (
    <>
      <button type="button" ref={sortMenu.anchorRef} className="btn cp-sort" onClick={sortMenu.toggle} aria-haspopup="menu" aria-expanded={sortMenu.open}>
        {sortLabel}
        <Icon name="chevronDown" size={13} className={`cp-caret ${sortMenu.open ? 'is-up' : ''}`} />
      </button>
      <Menu {...sortMenu.props} align="end">
        {SORTS.map(s => (
          <MenuItem key={s.value} checked={sort === s.value} onClick={() => setSort(s.value)}>{s.label}</MenuItem>
        ))}
      </Menu>
    </>
  );

  return (
    <div className="cp-page">
      {!isPhone && (
        <TopBarPortal>
          <SearchInput value={search} onChange={setSearch} placeholder="Search completed tasks" className="cp-topsearch" />
          {sortButton}
        </TopBarPortal>
      )}

      {/* ── Left: calendar + who completed ── */}
      <aside className="cp-side">
        <div className="cp-cal anim-rise">
          <CompletionCalendar
            tasks={personTasks}
            selectedDate={selectedDate}
            onSelectDate={pickDate}
            onToday={() => setSelectedDate(new Date())}
            onAllDates={() => setSelectedDate(null)}
            compact={isPhone}
          />
        </div>

        <div className="cp-people anim-rise" style={{ animationDelay: '60ms' }}>
          <div className="eyebrow cp-people-label">Completed by</div>
          <div className={`cp-people-list ${loading ? '' : 'stagger'}`}>
            {loading ? (
              [0, 1, 2].map(i => <span key={i} className="skel cp-person-skel" />)
            ) : (
              <>
                <PersonButton
                  label="All team members"
                  count={tasks.length}
                  active={person === 'all'}
                  onClick={() => setPerson('all')}
                  avatar={<span className="avatar cp-all-avatar" style={{ width: 24, height: 24 }}>All</span>}
                />
                {people.map(p => (
                  <PersonButton
                    key={p.name}
                    label={p.name}
                    count={p.count}
                    active={person === p.name}
                    onClick={() => setPerson(person === p.name ? 'all' : p.name)}
                    avatar={<Avatar person={p.user} name={p.name} size={24} />}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Right: the list ── */}
      <section className="cp-main">
        <header className="cp-head anim-rise">
          <div className="eyebrow" key={eyebrow}><span className="cp-eyebrow">{eyebrow}</span></div>
          <h1 className="page-title cp-title">
            Completed
            {!loading && (
              <span key={filtered.length} className="cp-title-count bump">
                {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
              </span>
            )}
          </h1>
        </header>

        {isPhone && (
          <div className="cp-phone-tools anim-rise">
            <SearchInput value={search} onChange={setSearch} placeholder="Search completed tasks" />
            {sortButton}
          </div>
        )}

        {error && <div className="notice notice-error cp-error"><Icon name="alert" size={15} />{error}</div>}

        <div className="table cp-table">
          <div className="table-head">
            <span>Task</span>
            <span>Page</span>
            <span>ROI</span>
            <span>Complexity</span>
            <span>Noticed by</span>
            <span>Completed</span>
            <span />
          </div>

          {loading ? (
            <SkeletonRows rows={6} widths={['38%', '12%', '8%', '9%', '12%', '7%']} />
          ) : filtered.length === 0 ? (
            <Empty icon="done" title={filtering ? 'No matches' : 'No completed tasks yet'}
              action={filtering && (
                <button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setPerson('all'); setSelectedDate(null); }}>
                  Clear filters
                </button>
              )}
            >
              {filtering
                ? (selectedDate && !search && person === 'all'
                  ? `Nothing was completed on ${format(selectedDate, 'MMM d')}.`
                  : 'Try another date, person or search.')
                : 'Tasks marked as complete will show up here.'}
            </Empty>
          ) : (
            <div className="stagger" key={filterKey}>
              {filtered.slice(0, limit).map(t => (
                <CompletedRow
                  key={t.id}
                  task={t}
                  onReopen={() => reopen(t)}
                  onDelete={() => setConfirmDel(t)}
                  onShot={() => setShot(t.png_url)}
                />
              ))}
            </div>
          )}
          {!loading && filtered.length > limit && (
            <div className="cp-more-row">
              <button type="button" className="btn btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>
                Show more <span className="count">{filtered.length - limit} left</span>
              </button>
            </div>
          )}
        </div>
        {selectedPerson && !loading && (
          <p className="cp-foot t-3">
            {selectedPerson.name} has completed <span className="mono">{selectedPerson.count}</span> {selectedPerson.count === 1 ? 'task' : 'tasks'} in all.
          </p>
        )}
      </section>

      {shot && <Lightbox src={shot} onClose={() => setShot(null)} />}
      {confirmDel && (
        <ConfirmDialog
          title="Delete this task?"
          text={`“${taskTitle(confirmDel)}” will be removed for everyone. This can't be undone.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

function PersonButton({ label, count, active, onClick, avatar }) {
  return (
    <button type="button" className={`cp-person ${active ? 'is-on' : ''}`} onClick={onClick} aria-pressed={active}>
      {avatar}
      <span className="cp-person-name truncate">{label}</span>
      <span key={count} className="cp-person-count bump">{count}</span>
    </button>
  );
}

function CompletedRow({ task, onReopen, onDelete, onShot }) {
  const menu = useMenu();
  const inside = (e) => e.currentTarget.contains(e.target);
  const title = taskTitle(task);
  const prio = task.roi === 'high' || task.roi === 'critical' ? 'prio-high' : '';

  return (
    <div
      className={`table-row cp-row ${menu.open ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      // The menu is portalled, but React still bubbles its clicks up here —
      // only react to events that really happened inside the row.
      onClick={(e) => { if (inside(e)) openTask(task); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTask(task); }}
      onContextMenu={(e) => { if (!inside(e)) return; e.preventDefault(); menu.setOpen(true); }}
    >
      <div className="table-cell cp-task">
        <span className="cp-check" aria-hidden="true"><Icon name="check" size={11} stroke={3} /></span>
        <span className="table-title cp-task-title">{title}</span>
        {task.png_url && <Icon name="image" size={13} className="t-4 cp-has-shot" />}
      </div>
      <div className="table-cell cp-page-cell">
        {isUrl(task.page) ? (
          <a href={task.page} target="_blank" rel="noreferrer" className="cp-link truncate" onClick={(e) => e.stopPropagation()}>
            {pageLabel(task.page)}
          </a>
        ) : <span className="truncate">{pageLabel(task.page) || '—'}</span>}
      </div>
      <div className={`table-cell hide-phone ${prio}`}>{cap(task.roi) || '—'}</div>
      <div className="table-cell hide-phone">{cap(task.complexity) || '—'}</div>
      <div className="table-cell"><span className="truncate">{task.noticed_by || '—'}</span></div>
      <div className="table-cell cp-date" title={task.date_completed ? format(new Date(task.date_completed), 'MMM d, yyyy · h:mm a') : ''}>
        {shortDate(task.date_completed) || '—'}
      </div>
      <div className="table-cell cp-actions">
        <button
          type="button"
          ref={menu.anchorRef}
          className="btn btn-ghost btn-sm btn-icon cp-more"
          onClick={(e) => { e.stopPropagation(); menu.toggle(); }}
          aria-label="Task actions"
          aria-haspopup="menu"
          aria-expanded={menu.open}
        >
          <Icon name="more" size={15} />
        </button>
        <Menu {...menu.props} align="end">
          <MenuItem icon="arrowUpRight" onClick={() => openTask(task)}>Open</MenuItem>
          {task.png_url && <MenuItem icon="image" onClick={onShot}>View screenshot</MenuItem>}
          <MenuItem icon="undo" onClick={onReopen}>Reopen</MenuItem>
          <MenuSep />
          <MenuItem icon="trash" danger onClick={onDelete}>Delete</MenuItem>
        </Menu>
      </div>
    </div>
  );
}
