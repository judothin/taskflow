import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isSameDay, startOfWeek, subDays, formatDistanceToNow } from 'date-fns';
import ActivityChart from './ActivityChart';
import { useTopBar } from '../context/TopBarContext';

// Live date/time readout for the dashboard top bar. Keeps its own tick so the
// rest of the dashboard doesn't re-render every second.
export function DashboardClock({ showDate, showTime }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!showDate && !showTime) return undefined;
    const interval = showTime ? 1000 : 60000;
    const id = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(id);
  }, [showDate, showTime]);

  if (!showDate && !showTime) return null;
  return (
    <div className="dash-datetime" aria-live="off">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
      </svg>
      {showDate && <span className="dash-dt-date">{format(now, 'EEE, MMM d, yyyy')}</span>}
      {showDate && showTime && <span className="dash-dt-sep" />}
      {showTime && <span className="dash-dt-time">{format(now, 'h:mm a')}</span>}
    </div>
  );
}

// Convenience wrapper that reads the shared top-bar preference. Drop it into
// any page's header so the date/time appears inline with that page's actions.
export function InlineClock() {
  const { display } = useTopBar();
  return <DashboardClock showDate={display.date} showTime={display.time} />;
}

// Shared widget header used by every dashboard widget.
export function WidgetHead({ icon, title, action }) {
  return (
    <div className="widget-head">
      <span className="widget-head-title">
        {icon && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
        )}
        {title}
      </span>
      {action}
    </div>
  );
}

const ROI_META = [
  { key: 'critical', label: 'Critical', color: '#f87171' },
  { key: 'high',     label: 'High',     color: '#fbbf24' },
  { key: 'medium',   label: 'Medium',   color: '#60a5fa' },
  { key: 'low',      label: 'Low',      color: '#4ade80' },
];

const fullName = (p) => `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
const namesIn  = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean);

// ── Your Activity (GitHub-style, locked to the signed-in user) ──
export function ActivityChartWidget({ completedTasks, users, profile }) {
  return (
    <>
      <WidgetHead icon="M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3" title="Your Activity" />
      <div className="widget-pad">
        <ActivityChart tasks={completedTasks} users={users} selectedUserId={profile?.id} hideSelect color="var(--accent)" />
      </div>
    </>
  );
}

// ── Completed Today ────────────────────────────────────────
export function CompletedTodayWidget({ completedTasks }) {
  const today = useMemo(
    () => completedTasks
      .filter(t => t.date_completed && isToday(new Date(t.date_completed)))
      .sort((a, b) => new Date(b.date_completed) - new Date(a.date_completed)),
    [completedTasks]
  );
  return (
    <>
      <WidgetHead
        icon="M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3"
        title="Completed Today"
        action={<span className="widget-count">{today.length}</span>}
      />
      {today.length === 0 ? (
        <p className="widget-empty">Nothing completed yet today.</p>
      ) : (
        <div className="recent-list">
          {today.slice(0, 8).map(t => (
            <div key={t.id} className="recent-item recent-item-anim">
              <span className="recent-item-title">{t.page || 'Untitled'}</span>
              <span className="recent-item-by">{t.completed_by || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── ROI Breakdown ──────────────────────────────────────────
export function RoiBreakdownWidget({ tasks }) {
  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    tasks.forEach(t => { if (c[t.roi] != null) c[t.roi] += 1; });
    return c;
  }, [tasks]);
  const total = tasks.length || 1;

  return (
    <>
      <WidgetHead
        icon="M21.21 15.89A10 10 0 118 2.83 M22 12A10 10 0 0012 2v10z"
        title="ROI Breakdown"
        action={<span className="widget-count">{tasks.length}</span>}
      />
      <div className="widget-pad roi-bars">
        {ROI_META.map(r => {
          const n = counts[r.key];
          const pct = Math.round((n / total) * 100);
          return (
            <div key={r.key} className="roi-row">
              <div className="roi-row-top">
                <span className="roi-label"><span className="roi-dot" style={{ background: r.color }} />{r.label}</span>
                <span className="roi-val">{n}</span>
              </div>
              <div className="roi-track">
                <div className="roi-fill" style={{ width: `${pct}%`, background: r.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Team Leaderboard (completions this week) ───────────────
export function LeaderboardWidget({ completedTasks, users }) {
  const ranked = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    const tally = {};
    completedTasks.forEach(t => {
      if (!t.date_completed) return;
      if (new Date(t.date_completed) < weekStart) return;
      namesIn(t.completed_by).forEach(name => { tally[name] = (tally[name] || 0) + 1; });
    });
    return Object.entries(tally)
      .map(([name, count]) => ({ name, count, color: colorFor(name, users) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [completedTasks, users]);

  const max = Math.max(1, ...ranked.map(r => r.count));

  return (
    <>
      <WidgetHead
        icon="M8 21h8 M12 17v4 M7 4h10v5a5 5 0 01-10 0z M5 9H3a2 2 0 01-2-2V5h4 M19 9h2a2 2 0 002-2V5h-4"
        title="Leaderboard"
        action={<span className="widget-sub">this week</span>}
      />
      {ranked.length === 0 ? (
        <p className="widget-empty">No completions this week yet.</p>
      ) : (
        <div className="widget-pad lb-list">
          {ranked.map((r, i) => (
            <div key={r.name} className="lb-row">
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-name">{r.name}</span>
              <div className="lb-track">
                <div className="lb-fill" style={{ width: `${(r.count / max) * 100}%`, background: r.color }} />
              </div>
              <span className="lb-count">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Recent Activity (created + completed feed) ─────────────
export function RecentActivityWidget({ tasks, completedTasks }) {
  const navigate = useNavigate();
  const feed = useMemo(() => {
    const events = [];
    tasks.forEach(t => t.created_at && events.push({
      id: `c-${t.id}`, kind: 'created', at: t.created_at, task: t,
    }));
    completedTasks.forEach(t => {
      if (t.created_at) events.push({ id: `c-${t.id}`, kind: 'created', at: t.created_at, task: t });
      if (t.date_completed) events.push({ id: `d-${t.id}`, kind: 'completed', at: t.date_completed, task: t });
    });
    return events.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 9);
  }, [tasks, completedTasks]);

  return (
    <>
      <WidgetHead icon="M12 8v4l3 3 M3.05 11a9 9 0 116.36 9.95" title="Recent Activity" />
      {feed.length === 0 ? (
        <p className="widget-empty">No recent activity.</p>
      ) : (
        <div className="ra-list">
          {feed.map(e => (
            <button key={e.id} className="ra-row" onClick={() => navigate(`/tasks/${e.task.id}`)}>
              <span className={`ra-dot ${e.kind === 'completed' ? 'ra-dot-done' : 'ra-dot-new'}`} />
              <span className="ra-body">
                <span className="ra-text">
                  <strong>{e.kind === 'completed' ? 'Completed' : 'Created'}</strong> {e.task.page || 'Untitled'}
                </span>
                <span className="ra-time">{timeAgo(e.at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Completion Streak (signed-in user) ─────────────────────
export function StreakWidget({ completedTasks, profile }) {
  const { streak, best } = useMemo(() => {
    const me = fullName(profile);
    const dayKeys = new Set();
    completedTasks.forEach(t => {
      if (!t.date_completed) return;
      if (me && !namesIn(t.completed_by).includes(me)) return;
      dayKeys.add(format(new Date(t.date_completed), 'yyyy-MM-dd'));
    });
    // Current streak: walk back from today (or yesterday) while days are present.
    let cur = 0;
    let cursor = new Date();
    if (!dayKeys.has(format(cursor, 'yyyy-MM-dd'))) cursor = subDays(cursor, 1);
    while (dayKeys.has(format(cursor, 'yyyy-MM-dd'))) { cur += 1; cursor = subDays(cursor, 1); }
    // Best streak across all recorded days.
    const sorted = [...dayKeys].sort();
    let bestRun = 0, run = 0, prev = null;
    sorted.forEach(k => {
      if (prev && isSameDay(subDays(new Date(k), 1), new Date(prev))) run += 1; else run = 1;
      bestRun = Math.max(bestRun, run); prev = k;
    });
    return { streak: cur, best: Math.max(bestRun, cur) };
  }, [completedTasks, profile]);

  return (
    <>
      <WidgetHead icon="M12 2s7 5 7 11a7 7 0 01-14 0c0-2 1-4 3-5 0 2 1 3 2 3 1.5 0 1-3-1-6 2 0 5 2 6 6" title="Your Streak" />
      <div className="widget-pad streak-body">
        <div className="streak-flame">🔥</div>
        <div className="streak-num">{streak}</div>
        <div className="streak-label">day{streak !== 1 ? 's' : ''} in a row</div>
        <div className="streak-best">Best: {best} day{best !== 1 ? 's' : ''}</div>
      </div>
    </>
  );
}

function colorFor(name, users) {
  const u = (users || []).find(u => fullName(u) === name);
  return u?.color || '#6366f1';
}

function timeAgo(iso) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }).replace('about ', ''); }
  catch { return ''; }
}
