import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import PomodoroTimer from '../components/PomodoroTimer';
import TaskCard from '../components/TaskCard';
import TaskForm from '../components/TaskForm';
import '../components/TaskCard.css';
import './Dashboard.css';
import './Pomodoro.css';

export default function Pomodoro() {
  const { activeTeamId } = useTeam();
  const [inProgress, setInProgress] = useState([]);
  const [queued, setQueued] = useState([]);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [editTask, setEditTask] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setInProgress([]); setQueued([]); setLoading(false); return; }
    const [{ data: ip }, { data: q }, allUsers, { data: projs }] = await Promise.all([
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).eq('status', 'in_progress').order('date_received', { ascending: false }),
      supabase.from('queue').select('id, position, tasks(*)').eq('team_id', activeTeamId).order('position'),
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    setInProgress(ip || []);
    setQueued((q || []).map(row => row.tasks).filter(Boolean));
    setUsers((allUsers || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
    setProjects(projs || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('pomodoro-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, fetchData)
      .subscribe();
    const handler = () => fetchData();
    window.addEventListener('tasks-changed', handler);
    window.addEventListener('queue-changed', handler);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('tasks-changed', handler);
      window.removeEventListener('queue-changed', handler);
    };
  }, [fetchData]);

  const totalTasks = inProgress.length + queued.length;

  return (
    <div className="dashboard fade-in">

      {/* Timer */}
      <div className="card pomo-card">
        <PomodoroTimer />
      </div>

      {/* In progress */}
      <section className="dashboard-section">
        <h2 className="section-title">
          <span className="status-dot status-dot-inprogress" />
          In Progress
          <span className="pomo-section-count">{inProgress.length}</span>
        </h2>
        {loading ? (
          <div className="loading-grid">{[1, 2].map(i => <div key={i} className="task-skeleton loading-pulse" />)}</div>
        ) : inProgress.length === 0 ? (
          <div className="card pomo-empty">Nothing in progress. Start a task from your queue or the tasks page.</div>
        ) : (
          <div className="tasks-grid">
            {inProgress.map(task => (
              <TaskCard key={task.id} task={task} onEdit={setEditTask} onDeleted={fetchData} users={users} projects={projects} />
            ))}
          </div>
        )}
      </section>

      {/* Queued */}
      <section className="dashboard-section">
        <h2 className="section-title">
          <span className="status-dot" style={{ background: 'var(--text-dim)' }} />
          Up Next
          <span className="pomo-section-count">{queued.length}</span>
        </h2>
        {loading ? (
          <div className="loading-grid">{[1, 2].map(i => <div key={i} className="task-skeleton loading-pulse" />)}</div>
        ) : queued.length === 0 ? (
          <div className="card pomo-empty">Your queue is clear. Add tasks to the queue to line them up here.</div>
        ) : (
          <div className="tasks-grid">
            {queued.map(task => (
              <TaskCard key={task.id} task={task} onEdit={setEditTask} onDeleted={fetchData} users={users} projects={projects} />
            ))}
          </div>
        )}
      </section>

      {editTask && (
        <TaskForm task={editTask} onClose={() => setEditTask(null)} onSaved={fetchData} users={users} projects={projects} />
      )}
    </div>
  );
}
