import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths,
  differenceInCalendarDays, startOfToday,
} from 'date-fns';
import AnimatedPopover from './AnimatedPopover';
import './DatePicker.css';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Custom calendar-popover date picker (no native <input type="date">, whose
// browser-drawn calendar can't be restyled and looks inconsistent across
// platforms). `value`/`onChange` are plain 'yyyy-MM-dd' strings (or null) —
// a due date is a calendar day, not a point in time, so there's no time-of-day
// or timezone to reconcile.
//
// `variant="input"` (default) renders a full-width field for forms.
// `variant="badge"` renders a small chip for inline quick-edit (e.g. on a
// task card) — it glows/pulses along a green→red urgency scale based on how
// close the due date is. Pass `completed` (the task is already done) to turn
// that off and show a flat, neutral chip instead — urgency no longer matters.
export default function DatePicker({ value, onChange, placeholder = 'No due date', disabled = false, variant = 'input', completed = false }) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState('next');
  const ref = useRef(null);

  const selected = value ? parseISO(value) : null;
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected || new Date()));

  // Only jump to the relevant month when the popover opens, not on every keystroke/selection.
  useEffect(() => {
    if (open) setViewMonth(startOfMonth(selected || new Date()));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  const prev = () => { setDir('prev'); setViewMonth(m => addMonths(m, -1)); };
  const next = () => { setDir('next'); setViewMonth(m => addMonths(m, 1)); };

  const pick = (day) => { onChange(format(day, 'yyyy-MM-dd')); setOpen(false); };
  const clear = () => { onChange(null); setOpen(false); };

  const calendarIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );

  const popover = (
    <AnimatedPopover open={open} className="date-picker-popover" onClick={(e) => e.stopPropagation()}>
      <div className="dp-header">
        <button type="button" className="dp-nav" onClick={prev} aria-label="Previous month">‹</button>
        <span className="dp-month">{format(viewMonth, 'MMMM yyyy')}</span>
        <button type="button" className="dp-nav" onClick={next} aria-label="Next month">›</button>
      </div>

      <div className="dp-grid dp-dow-row">
        {DOW.map((d, i) => <div key={i} className="dp-dow">{d}</div>)}
      </div>

      <div className={`dp-grid dp-grid-days dp-grid-${dir}`} key={format(viewMonth, 'yyyy-MM')}>
        {days.map((day, i) => {
          const inMonth = isSameMonth(day, viewMonth);
          const isSelected = selected && isSameDay(day, selected);
          const today = isToday(day);
          return (
            <button
              key={key(day) + i}
              type="button"
              className={[
                'dp-day',
                !inMonth ? 'dp-day-out' : '',
                isSelected ? 'dp-day-selected' : '',
                today && !isSelected ? 'dp-day-today' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => pick(day)}
              title={format(day, 'MMM d, yyyy')}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      <div className="dp-footer">
        <button type="button" className="dp-footer-btn" onClick={() => pick(new Date())}>Today</button>
        {value && <button type="button" className="dp-footer-btn dp-footer-btn-clear" onClick={clear}>Clear</button>}
      </div>
    </AnimatedPopover>
  );

  if (variant === 'badge') {
    // Urgency scale: how many calendar days away is the due date? Negative
    // means overdue. Ignored once the task is completed — a done task's due
    // date is just a record, not something to keep signaling urgency about.
    const urgency = value && !completed ? urgencyOf(differenceInCalendarDays(selected, startOfToday())) : null;
    const badgeClass = value
      ? (urgency ? `date-badge-${urgency} date-badge-pulse` : 'date-badge-done')
      : 'badge-add-project';

    return (
      <span className="date-picker date-picker-badge-wrap" ref={ref}>
        <button
          type="button"
          className={`badge badge-editable ${badgeClass}`}
          title={value ? `Due ${format(selected, 'MMM d, yyyy')}${urgency === 'overdue' ? ' — overdue' : ''} — click to change` : 'Set a due date'}
          onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen(v => !v); }}
        >
          {calendarIcon}
          {value ? format(selected, 'MMM d') : placeholder}
        </button>
        {popover}
      </span>
    );
  }

  return (
    <div className="date-picker" ref={ref}>
      <button
        type="button"
        className={`date-picker-trigger ${disabled ? 'date-picker-trigger-disabled' : ''}`}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
      >
        <span className="date-picker-icon">{calendarIcon}</span>
        <span className={`date-picker-value ${!value ? 'date-picker-placeholder' : ''}`}>
          {selected ? format(selected, 'MMM d, yyyy') : placeholder}
        </span>
        {value && (
          <span
            className="date-picker-clear"
            role="button"
            aria-label="Clear due date"
            title="Clear due date"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        )}
      </button>
      {popover}
    </div>
  );
}

function key(day) { return day.getTime ? day.getTime() : String(day); }

// Green (plenty of time) → red (overdue) urgency scale for the badge glow.
function urgencyOf(daysAway) {
  if (daysAway < 0) return 'overdue';
  if (daysAway === 0) return 'today';
  if (daysAway <= 2) return 'soon';
  if (daysAway <= 5) return 'upcoming';
  return 'far';
}
