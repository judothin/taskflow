import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import './AccountStatsCard.css';

// Icons shared by the stat tiles (small chip + faint corner watermark).
export const STAT_ICONS = {
  completed: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
  created: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 8v8 M8 12h8',
};

// One premium stat tile — used by both the Settings card and the dashboard
// widget. `color` is any CSS color (e.g. 'var(--success)'), piped through a
// custom property so the icon chip, number, glow, and watermark all match.
export function StatTile({ value, label, color, iconPath }) {
  const display = value === null || value === undefined ? '—' : Number(value).toLocaleString();
  return (
    <div className="account-stat" style={{ '--tile-color': color }}>
      <div className="account-stat-icon">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath} /></svg>
      </div>
      <div className="account-stat-value">{display}</div>
      <div className="account-stat-label">{label}</div>
      <svg className="account-stat-wm" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPath} /></svg>
    </div>
  );
}

// Permanent account-stats card for Settings: tasks completed (from the
// user_levels counter) and tasks created (live count of tasks you authored).
export default function AccountStatsCard({ userId, tasksCompleted }) {
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    (async () => {
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId);
      if (live) setCreated(count ?? 0);
    })();
    return () => { live = false; };
  }, [userId]);

  return (
    <div className="card account-stats-card">
      <h2 className="account-stats-title">Your Stats</h2>
      <div className="account-stats-grid">
        <StatTile value={tasksCompleted ?? 0} label="Tasks Completed" color="var(--success)" iconPath={STAT_ICONS.completed} />
        <StatTile value={created} label="Tasks Created" color="var(--accent)" iconPath={STAT_ICONS.created} />
      </div>
    </div>
  );
}
