import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import TaskCard from '../components/TaskCard';
import MobileTaskList from '../components/MobileTaskList';
import useIsPhone from '../lib/useIsPhone';
import '../components/TaskCard.css';
import './Dashboard.css';
import './Companion.css';

// Standalone Current Focus — what's in progress plus the up-next queue, in
// the order you'd work them. The dashboard has this as a widget; this is the
// same list as its own page, which is what the phone dock points at (the full
// dashboard's widget grid is far more than a companion needs).
export default function Focus() {
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();
  const [tasks, setTasks] = useState([]);
  const [queue, setQueue] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setTasks([]); setQueue([]); setLoading(false); return; }
    const [{ data: allTasks }, { data: q }, members, { data: projs }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).neq('status', 'completed'),
      supabase.from('queue').select('id, task_id, position, tasks(*)').eq('team_id', activeTeamId).order('position'),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    setTasks(allTasks || []);
    setQueue((q || []).filter(r => r.tasks && r.tasks.status !== 'completed'));
    setUsers(members || []);
    setProjects(projs || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Completing a task from a card fires this app-wide, and the queue panel
  // fires the other — either way this list is now stale.
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('tasks-changed', handler);
    window.addEventListener('queue-changed', handler);
    return () => {
      window.removeEventListener('tasks-changed', handler);
      window.removeEventListener('queue-changed', handler);
    };
  }, [fetchData]);

  // In-progress first, then the queue in its own order, no repeats.
  const focusTasks = useMemo(() => {
    const seen = new Set();
    const list = [];
    tasks.filter(t => t.status === 'in_progress').forEach(t => {
      if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
    });
    queue.forEach(q => {
      if (!seen.has(q.tasks.id)) { seen.add(q.tasks.id); list.push(q.tasks); }
    });
    return list;
  }, [tasks, queue]);

  return (
    <div className="dashboard fade-in">
      <section className="dashboard-section">
        {/* The top bar already names this screen on a phone — two headings
            stacked is exactly the noise the companion is trimming. */}
        {!isPhone && (
          <h2 className="section-title">
            <span className="status-dot status-dot-inprogress" />
            Current Focus
            <span className="focus-hint">in progress &amp; up next</span>
          </h2>
        )}

        {loading ? (
          <div className="companion-list">
            {[1, 2].map(i => <div key={i} className="task-skeleton loading-pulse" />)}
          </div>
        ) : isPhone ? (
          /* Split rather than a flat list: "what I'm on" vs "what's next" is
             the only distinction that matters at a glance. */
          <MobileTaskList
            users={users}
            onChanged={fetchData}
            empty="Nothing in focus. Start a task or add one to your queue."
            groups={[
              { key: 'now',  label: 'In Progress', tasks: focusTasks.filter(t => t.status === 'in_progress') },
              { key: 'next', label: 'Up Next',     tasks: focusTasks.filter(t => t.status !== 'in_progress') },
            ]}
          />
        ) : focusTasks.length === 0 ? (
          <div className="companion-empty">
            <p>Nothing in focus.</p>
            <p className="companion-empty-sub">Start a task or add one to your queue.</p>
          </div>
        ) : (
          <div className="companion-list">
            {focusTasks.map((task, i) => {
              const isCurrent = task.status === 'in_progress';
              const upNextNum = focusTasks.slice(0, i + 1).filter(t => t.status !== 'in_progress').length;
              return (
                <div key={task.id} className="focus-slot">
                  <span className={`focus-order-tag ${isCurrent ? 'focus-order-tag-current' : ''}`}>
                    {isCurrent ? (<><span className="focus-tag-dot" /> In Progress</>) : `Up Next · ${upNextNum}`}
                  </span>
                  <TaskCard
                    task={task}
                    onDeleted={fetchData}
                    featured
                    users={users}
                    projects={projects}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
