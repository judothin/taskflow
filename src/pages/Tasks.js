import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import useRefresh from '../lib/useRefresh';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { TopBarPortal } from '../context/HeaderActionsContext';
import { openNewTask, TASKS_CHANGED } from '../lib/events';
import { taskTitle } from '../lib/taskText';
import useBulkSelect from '../lib/useBulkSelect';
import TaskTable, { GROUPS } from '../components/TaskTable';
import BulkActionBar from '../components/BulkActionBar';
import { Icon, Menu, MenuItem, MenuSep, MenuLabel, useMenu, PageHeader, SearchInput, Tabs, fullName, cap } from '../ui';
import './Tasks.css';

const TABS = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'critical', label: 'Critical' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];
const SORTS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'roi', label: 'Priority' },
  { value: 'due', label: 'Due date' },
];
const ROI_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const matchTab = (t, tab) => {
  if (tab === 'all') return true;
  if (tab === 'active') return t.status !== 'completed';
  if (tab === 'critical') return t.status !== 'completed' && (t.status === 'critical' || t.roi === 'critical');
  return t.status === tab;
};

export default function Tasks() {
  const { activeTeamId } = useTeam();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [roi, setRoi] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('tf-tasks-group') || 'status');
  const bulk = useBulkSelect();
  const filterMenu = useMenu();
  const sortMenu = useMenu();
  const groupMenu = useMenu();
  const loaded = useRef(false);

  const { run, refresh } = useRefresh(async (isStale) => {
    if (!activeTeamId) { setTasks([]); setLoading(false); return; }
    if (!loaded.current) setLoading(true);
    const [{ data }, members] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }),
      fetchTeamMembers(activeTeamId),
    ]);
    if (isStale()) return;
    loaded.current = true;
    setTasks(data || []);
    setUsers((members || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
    setLoading(false);
  });

  useEffect(() => { run(); }, [activeTeamId, run]);
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, refresh);
    return () => window.removeEventListener(TASKS_CHANGED, refresh);
  }, [refresh]);

  const counts = useMemo(() => {
    const c = {};
    TABS.forEach(t => { c[t.value] = tasks.filter(x => matchTab(x, t.value)).length; });
    return c;
  }, [tasks]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tasks.filter(t => matchTab(t, tab)
      && (roi === 'all' || t.roi === roi)
      && (assignee === 'all' || (assignee === 'none' ? !t.assignee_id : t.assignee_id === assignee))
      && (!q || [taskTitle(t), t.page, t.noticed_by, t.feedback, t.completed_by].some(v => (v || '').toLowerCase().includes(q))));
    return [...list].sort((a, b) => {
      if (sort === 'date_asc') return new Date(a.date_received) - new Date(b.date_received);
      if (sort === 'roi') return (ROI_RANK[a.roi] ?? 4) - (ROI_RANK[b.roi] ?? 4);
      if (sort === 'due') return (a.due_date || '9999').localeCompare(b.due_date || '9999');
      return new Date(b.date_received) - new Date(a.date_received);
    });
  }, [tasks, tab, roi, assignee, search, sort]);

  const filterCount = (roi !== 'all') + (assignee !== 'all');
  const setGroup = (g) => { setGroupBy(g); try { localStorage.setItem('tf-tasks-group', g); } catch { /* ignore */ } };
  const allShownSelected = shown.length > 0 && shown.every(t => bulk.selectedIds.has(t.id));

  return (
    <div className="page tk">
      <TopBarPortal>
        <button type="button" className={`btn ${bulk.selectMode ? 'btn-primary' : ''} hide-phone`} onClick={bulk.toggleSelectMode}>
          <Icon name="check" size={14} />{bulk.selectMode ? 'Done' : 'Select'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => openNewTask()}>
          <Icon name="plus" size={15} stroke={2.2} /><span className="hide-phone">New task</span><span className="show-phone">New</span>
        </button>
      </TopBarPortal>

      <PageHeader
        eyebrow="Work"
        title="Tasks"
        sub={<>{counts.active} active<span className="sep">·</span>{counts.completed} completed</>}
      />

      <Tabs value={tab} onChange={setTab} items={TABS.map(t => ({ ...t, count: counts[t.value] }))} />

      <div className="tk-bar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tasks" className="tk-search" />
        <div className="tk-bar-right">
          {bulk.selectMode && (
            <button type="button" className="btn btn-ghost anim-pop" onClick={() => bulk.toggleAll(shown.map(t => t.id))}>
              {allShownSelected ? 'Clear all' : 'Select all'}
            </button>
          )}
          <button ref={filterMenu.anchorRef} type="button" className="btn" onClick={filterMenu.toggle}>
            <Icon name="filter" size={14} />Filter
            {filterCount > 0 && <span key={filterCount} className="tk-badge bump">{filterCount}</span>}
          </button>
          <button ref={sortMenu.anchorRef} type="button" className="btn" onClick={sortMenu.toggle}>
            {SORTS.find(s => s.value === sort)?.label}<Icon name="chevronDown" size={13} />
          </button>
          <button ref={groupMenu.anchorRef} type="button" className="btn hide-phone" onClick={groupMenu.toggle}>
            Group: {GROUPS.find(g => g.value === groupBy)?.label}
          </button>
        </div>
      </div>

      <Menu {...filterMenu.props} align="end" width={240}>
        <MenuLabel>Priority</MenuLabel>
        {['all', 'critical', 'high', 'medium', 'low'].map(r => (
          <MenuItem key={r} checked={roi === r} onClick={() => setRoi(r)} keepOpen>{r === 'all' ? 'Any priority' : cap(r)}</MenuItem>
        ))}
        <MenuSep />
        <MenuLabel>Assignee</MenuLabel>
        <MenuItem checked={assignee === 'all'} onClick={() => setAssignee('all')} keepOpen>Anyone</MenuItem>
        <MenuItem checked={assignee === 'none'} onClick={() => setAssignee('none')} keepOpen>Unassigned</MenuItem>
        {users.map(u => <MenuItem key={u.id} checked={assignee === u.id} onClick={() => setAssignee(u.id)} keepOpen>{fullName(u)}</MenuItem>)}
        {filterCount > 0 && (<><MenuSep /><MenuItem icon="x" onClick={() => { setRoi('all'); setAssignee('all'); }}>Clear filters</MenuItem></>)}
      </Menu>
      <Menu {...sortMenu.props} align="end" width={180}>
        {SORTS.map(s => <MenuItem key={s.value} checked={sort === s.value} onClick={() => setSort(s.value)}>{s.label}</MenuItem>)}
      </Menu>
      <Menu {...groupMenu.props} align="end" width={180}>
        {GROUPS.map(g => <MenuItem key={g.value} checked={groupBy === g.value} onClick={() => setGroup(g.value)}>{g.label}</MenuItem>)}
      </Menu>

      <TaskTable
        tasks={shown}
        users={users}
        groupBy={groupBy}
        loading={loading}
        columns={['task', 'page', 'status', 'priority', 'assignee', 'due', 'posted']}
        select={bulk.selectMode ? { ids: bulk.selectedIds, toggle: bulk.toggle } : null}
        empty={search || filterCount ? 'Nothing matches those filters.' : 'No tasks here yet.'}
      />

      {bulk.selectMode && (
        <BulkActionBar
          selectedTasks={tasks.filter(t => bulk.selectedIds.has(t.id))}
          users={users}
          onChanged={refresh}
          onClear={bulk.clear}
          onExit={bulk.exitSelectMode}
        />
      )}
    </div>
  );
}
