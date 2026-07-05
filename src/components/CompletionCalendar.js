import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths,
} from 'date-fns';
import './CompletionCalendar.css';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Month calendar that surfaces completed-task activity per day.
 *  - `tasks`        completed tasks (uses `date_completed`)
 *  - `selectedDate` currently focused day (Date | null)
 *  - `onSelectDate` (Date) => void
 *  - `color`        accent used for activity dots + the selected day
 *  - `compact`      tighter layout for the dashboard sidebar
 */
export default function CompletionCalendar({
  tasks = [],
  selectedDate,
  onSelectDate,
  color = 'var(--accent)',
  compact = false,
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate || new Date()));
  const [dir, setDir] = useState('next'); // slide direction for month transitions

  // Follow the selection into its month only when the selection *changes*
  // (e.g. "Today" or a date passed from another page) — not when the user is
  // manually paging through months.
  const prevSelectedKey = useRef(selectedDate ? selectedDate.getTime() : null);
  useEffect(() => {
    const key = selectedDate ? selectedDate.getTime() : null;
    if (key !== prevSelectedKey.current) {
      if (selectedDate && !isSameMonth(selectedDate, viewMonth)) {
        setDir(selectedDate < viewMonth ? 'prev' : 'next');
        setViewMonth(startOfMonth(selectedDate));
      }
      prevSelectedKey.current = key;
    }
  }, [selectedDate, viewMonth]);

  const dayCounts = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (!t.date_completed) return;
      const key = format(new Date(t.date_completed), 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [tasks]);

  const maxCount = Math.max(1, ...Object.values(dayCounts));

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd]
  );

  const prev = () => { setDir('prev'); setViewMonth(m => addMonths(m, -1)); };
  const next = () => { setDir('next'); setViewMonth(m => addMonths(m, 1)); };
  const goToday = () => { const t = new Date(); setDir('next'); setViewMonth(startOfMonth(t)); onSelectDate?.(t); };

  return (
    <div className={`cc ${compact ? 'cc-compact' : ''}`}>
      <div className="cc-header">
        <button className="cc-nav" onClick={prev} aria-label="Previous month">‹</button>
        <span className="cc-month">{format(viewMonth, 'MMMM yyyy')}</span>
        <button className="cc-nav" onClick={next} aria-label="Next month">›</button>
      </div>

      <div className="cc-grid cc-dow-row">
        {DOW.map((d, i) => <div key={i} className="cc-dow">{d}</div>)}
      </div>

      <div className={`cc-grid cc-grid-days cc-grid-${dir}`} key={format(viewMonth, 'yyyy-MM')}>
        {days.map((day, i) => {
          const key = format(day, 'yyyy-MM-dd');
          const count = dayCounts[key] || 0;
          const inMonth = isSameMonth(day, viewMonth);
          const selected = selectedDate && isSameDay(day, selectedDate);
          const today = isToday(day);
          const intensity = count ? 0.35 + (count / maxCount) * 0.65 : 0;

          const style = {};
          if (selected) { style.background = color; style.borderColor = color; }

          return (
            <button
              key={key + i}
              type="button"
              className={[
                'cc-day',
                !inMonth ? 'cc-day-out' : '',
                selected ? 'cc-day-selected' : '',
                today && !selected ? 'cc-day-today' : '',
                count ? 'cc-day-has' : '',
              ].filter(Boolean).join(' ')}
              style={style}
              onClick={() => onSelectDate?.(day)}
              title={count ? `${count} completed on ${format(day, 'MMM d, yyyy')}` : format(day, 'MMM d, yyyy')}
            >
              <span className="cc-day-num">{format(day, 'd')}</span>
              {count > 0 && !compact && (
                <span className="cc-day-count" style={selected ? undefined : { color }}>{count}</span>
              )}
              {count > 0 && (
                <span
                  className="cc-day-dot"
                  style={{ background: selected ? '#fff' : color, opacity: selected ? 0.9 : intensity }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="cc-footer">
        <button className="cc-today-btn" onClick={goToday}>Today</button>
      </div>
    </div>
  );
}
