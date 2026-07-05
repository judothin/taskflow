import React, { useMemo, useState } from 'react';
import {
  format, addMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval, isToday, isFuture, isSameMonth,
} from 'date-fns';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ActivityChart({ tasks, users, selectedUserId, onUserChange, hideSelect = false, color = null }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [dir, setDir] = useState('next'); // slide direction for month transitions

  const goPrev = () => { setDir('prev'); setMonthOffset(o => o - 1); };
  const goNext = () => { setDir('next'); setMonthOffset(o => o + 1); };

  const month = useMemo(() => addMonths(startOfMonth(new Date()), monthOffset), [monthOffset]);

  // Full weeks covering the month → calendar grid (7 columns, ~4–6 rows).
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  const weeks = useMemo(() => {
    const ws = [];
    for (let i = 0; i < days.length; i += 7) ws.push(days.slice(i, i + 7));
    return ws;
  }, [days]);

  const filteredTasks = useMemo(() => {
    if (!selectedUserId) return tasks;
    const user = users.find(u => u.id === selectedUserId);
    if (!user) return tasks;
    const name = `${user.first_name} ${user.last_name}`;
    return tasks.filter(t =>
      (t.completed_by || '').split(',').map(s => s.trim()).includes(name)
    );
  }, [tasks, users, selectedUserId]);

  const dayMap = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      if (!t.date_completed) return;
      const d = format(new Date(t.date_completed), 'yyyy-MM-dd');
      map[d] = (map[d] || 0) + 1;
    });
    return map;
  }, [filteredTasks]);

  const maxCount = Math.max(1, ...Object.values(dayMap));
  // Blend the accent into the cell's own surface (opaque) rather than fading
  // the whole cell with opacity — the latter washes out on light backgrounds.
  const intensityPct = (count) => Math.round(42 + (count / maxCount) * 58);

  const userColor = useMemo(() => {
    if (color) return color;                       // explicit override (e.g. secondary theme color)
    if (!selectedUserId) return 'var(--accent)';
    const u = users.find(u => u.id === selectedUserId);
    return u?.color || 'var(--accent)';
  }, [color, selectedUserId, users]);

  const monthTotal = useMemo(() =>
    days.reduce((sum, d) => (isSameMonth(d, month) ? sum + (dayMap[format(d, 'yyyy-MM-dd')] || 0) : sum), 0),
    [days, dayMap, month]
  );

  return (
    <div className="activity-chart">
      <div className="chart-controls">
        <div className="chart-month-nav">
          <button className="chart-nav-btn" onClick={goPrev} aria-label="Previous month">‹</button>
          <span className="chart-month-name">{format(month, 'MMMM yyyy')}</span>
          <button className="chart-nav-btn" onClick={goNext} disabled={monthOffset >= 0} aria-label="Next month">›</button>
        </div>
        {!hideSelect && (
          <select
            className="input"
            style={{ width: 'auto', fontSize: 13, padding: '6px 12px' }}
            value={selectedUserId || ''}
            onChange={e => onUserChange(e.target.value || null)}
          >
            <option value="">All Team Members</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`chart-cal chart-cal-${dir}`} key={monthOffset}>
        {/* Day-of-week header */}
        <div className="chart-cal-row chart-cal-head">
          {DOW.map(d => <div key={d} className="chart-cal-dow">{d}</div>)}
        </div>

        {/* Week rows of wide rectangle cells */}
        {weeks.map((week, wi) => (
          <div key={wi} className="chart-cal-row">
            {week.map((day, di) => {
              const inMonth = isSameMonth(day, month);
              const future = isFuture(day) && !isToday(day);
              const key = format(day, 'yyyy-MM-dd');
              const count = dayMap[key] || 0;
              const active = count && !future && inMonth;
              const pct = active ? intensityPct(count) : 0;
              return (
                <div
                  key={di}
                  className={`chart-cell ${!inMonth ? 'chart-cell-out' : ''} ${isToday(day) ? 'chart-cell-today' : ''} ${active ? 'chart-cell-filled' : ''}`}
                  title={inMonth && !future ? `${format(day, 'MMM d, yyyy')}: ${count} task${count !== 1 ? 's' : ''}` : ''}
                  style={active ? {
                    background: `color-mix(in srgb, ${userColor} ${pct}%, var(--bg-4))`,
                    borderColor: `color-mix(in srgb, ${userColor} ${Math.min(100, pct + 14)}%, var(--bg-4))`,
                  } : undefined}
                >
                  <span className="chart-cell-date">{format(day, 'd')}</span>
                  {active ? <span className="chart-cell-count">{count}</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: total + legend */}
      <div className="chart-footer">
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{monthTotal}</strong> completed in {format(month, 'MMMM')}
        </span>
        <div className="chart-legend">
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Less</span>
          {[25, 45, 65, 85, 100].map((p, i) => (
            <div key={i} className="chart-legend-sq" style={{ background: `color-mix(in srgb, ${userColor} ${p}%, var(--bg-4))` }} />
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>More</span>
        </div>
      </div>
    </div>
  );
}
