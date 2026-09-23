import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isToday } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import { useStreak } from '../context/StreakContext';
import AccountStatsCard from '../components/AccountStatsCard';
import StreakFlame from '../components/StreakFlame';
import './Dashboard.css';
import './Companion.css';

const STATUS_FILTERS = [
  { key: 'critical',    label: 'Critical',    color: 'var(--st-critical)' },
  { key: 'open',        label: 'Open',        color: 'var(--st-open)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--st-inprogress)' },
  { key: 'on_hold',     label: 'On Hold',     color: 'var(--st-onhold)' },
  { key: 'completed',   label: 'Completed',   color: 'var(--st-completed)' },
  { key: 'done_today',  label: 'Done Today',  color: 'var(--accent)', to: '/completed' },
];

// Standalone numbers page: the dashboard's task counts plus your own totals,
// without the widget grid. The phone dock points here.
export default function Stats() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const { userLevel } = usePets();
  const { days: streakDays, best: streakBest, paused: streakPaused, teamId: streakTeamId } = useStreak();
  const [tasks, setTasks] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setTasks([]); setCompleted([]); setLoading(false); return; }
    const { data } = await supabase
      .from('tasks').select('id, status, roi, date_completed, completed_by')
      .eq('team_id', activeTeamId);
    setTasks((data || []).filter(t => t.status !== 'completed'));
    setCompleted((data || []).filter(t => t.status === 'completed'));
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('tasks-changed', handler);
    return () => window.removeEventListener('tasks-changed', handler);
  }, [fetchData]);

  const doneToday = useMemo(
    () => completed.filter(t => t.date_completed && isToday(new Date(t.date_completed))).length,
    [completed]
  );

  const count = (key) => {
    if (loading) return '—';
    if (key === 'done_today') return doneToday;
    if (key === 'completed') return completed.length;
    // Critical = critical status OR critical ROI (both read as urgent).
    if (key === 'critical') return tasks.filter(t => t.status === 'critical' || t.roi === 'critical').length;
    return tasks.filter(t => t.status === key).length;
  };

  return (
    <div className="dashboard fade-in">
      <div className="stats-grid">
        {STATUS_FILTERS.map(s => (
          <button
            key={s.key}
            className="stat-card stat-card-btn"
            onClick={() => (s.to ? navigate(s.to) : navigate('/active', { state: { status: s.key } }))}
            title={s.key === 'done_today' ? "View today's completed tasks" : `View ${s.label} tasks`}
          >
            <div className="stat-value" style={{ color: s.color }}>{count(s.key)}</div>
            <div className="stat-label">{s.label}</div>
          </button>
        ))}
      </div>

      <div className="companion-stats-row">
        <AccountStatsCard userId={user?.id} tasksCompleted={userLevel?.tasks_completed} />
        <div className="card companion-streak-card">
          {/* StreakFlame renders nothing below the first tier, so the card
              states the count either way. */}
          <StreakFlame days={streakDays} paused={streakPaused} teamId={streakTeamId} size={52} />
          <div className="companion-streak-text">
            <div className="companion-streak-days">
              {streakDays} day{streakDays === 1 ? '' : 's'}
              {streakPaused && <span className="companion-streak-paused">paused</span>}
            </div>
            <div className="companion-streak-label">Current streak · best {streakBest}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
