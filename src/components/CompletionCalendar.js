import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addWeeks,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths, addDays,
} from 'date-fns';
import { Icon } from '../ui';
import './CompletionCalendar.css';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Month calendar of completed-task activity (Completed page).
 *   tasks         completed tasks (reads `date_completed`)
 *   selectedDate  the focused day, or null for "all dates"
 *   onSelectDate  (Date) => void
 *   onToday       () => void   "Today" button
 *   onAllDates    () => void   "All dates" button
 *   compact       phone layout: a one-week strip that expands to the month
 */
export default function CompletionCalendar({
  tasks = [], selectedDate, onSelectDate, onToday, onAllDates, compact = false,
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate || new Date()));
  const [viewWeek, setViewWeek] = useState(() => startOfWeek(selectedDate || new Date()));
  const [dir, setDir] = useState('next');
  const [expanded, setExpanded] = useState(false);

  // Follow the selection into its month / week only when the selection
  // itself changes (Today, a date passed in) — not while paging by hand.
  const prevKey = useRef(selectedDate ? selectedDate.getTime() : null);
  useEffect(() => {
    const key = selectedDate ? selectedDate.getTime() : null;
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (!selectedDate) return;
    if (!isSameMonth(selectedDate, viewMonth)) {
      setDir(selectedDate < viewMonth ? 'prev' : 'next');
      setViewMonth(startOfMonth(selectedDate));
    }
    setViewWeek(startOfWeek(selectedDate));
  }, [selectedDate, viewMonth]);

  const dayCounts = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      if (!t.date_completed) continue;
      const k = format(new Date(t.date_completed), 'yyyy-MM-dd');
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [tasks]);

  const weekMode = compact && !expanded;
  const monthKey = format(viewMonth, 'yyyy-MM');
  const weekKey = format(viewWeek, 'yyyy-MM-dd');
  const days = useMemo(() => {
    if (weekMode) return eachDayOfInterval({ start: viewWeek, end: addDays(viewWeek, 6) });
    const m = new Date(`${monthKey}-01T00:00:00`);
    return eachDayOfInterval({ start: startOfWeek(startOfMonth(m)), end: endOfWeek(endOfMonth(m)) });
  }, [weekMode, monthKey, viewWeek]);

  const step = (n) => {
    setDir(n < 0 ? 'prev' : 'next');
    if (weekMode) {
      const w = addWeeks(viewWeek, n);
      setViewWeek(w);
      setViewMonth(startOfMonth(addDays(w, 3)));
    } else {
      setViewMonth(m => addMonths(m, n));
    }
  };

  const heading = weekMode
    ? format(addDays(viewWeek, 3), 'MMMM yyyy')
    : format(viewMonth, 'MMMM yyyy');

  return (
    <div className={`cc ${compact ? 'cc-compact' : ''} ${weekMode ? 'cc-week' : ''}`}>
      <div className="cc-head">
        {compact ? (
          <button type="button" className="cc-month cc-month-btn" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
            <span key={heading} className="cc-month-text">{heading}</span>
            <Icon name="chevronDown" size={14} className={`cc-caret ${expanded ? 'is-up' : ''}`} />
          </button>
        ) : (
          <span key={heading} className="cc-month cc-month-text">{heading}</span>
        )}
        <div className="cc-nav">
          <button type="button" className="cc-nav-btn" onClick={() => step(-1)} aria-label={weekMode ? 'Previous week' : 'Previous month'}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <button type="button" className="cc-nav-btn" onClick={() => step(1)} aria-label={weekMode ? 'Next week' : 'Next month'}>
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
      </div>

      <div className="cc-grid cc-dow-row" aria-hidden="true">
        {DOW.map(d => <span key={d} className="cc-dow">{d}</span>)}
      </div>

      <div className={`cc-grid cc-days cc-${dir}`} key={weekMode ? `w-${weekKey}` : `m-${monthKey}`}>
        {days.map((day, i) => {
          const k = format(day, 'yyyy-MM-dd');
          const count = dayCounts[k] || 0;
          const out = !weekMode && !isSameMonth(day, viewMonth);
          const selected = !!selectedDate && isSameDay(day, selectedDate);
          const today = isToday(day);
          return (
            <button
              key={k}
              type="button"
              style={{ '--i': i }}
              className={[
                'cc-day',
                out ? 'is-out' : '',
                count ? 'has-count' : '',
                selected ? 'is-selected' : '',
                today ? 'is-today' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSelectDate?.(day)}
              aria-pressed={selected}
              title={count ? `${count} completed · ${format(day, 'MMM d, yyyy')}` : format(day, 'MMM d, yyyy')}
            >
              <span className="cc-num">{format(day, 'd')}</span>
              {count > 0 && <span key={count} className="cc-count bump">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="cc-foot">
        <button type="button" className="btn btn-sm" onClick={onToday}>Today</button>
        <button
          type="button"
          className={`btn btn-sm btn-ghost cc-all ${selectedDate ? '' : 'is-on'}`}
          onClick={onAllDates}
          aria-pressed={!selectedDate}
        >
          All dates
        </button>
      </div>
    </div>
  );
}
