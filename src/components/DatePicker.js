import React, { useEffect, useMemo, useState } from 'react';
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths,
  differenceInCalendarDays, startOfToday,
} from 'date-fns';
import { Icon, Menu, useMenu } from '../ui';
import './DatePicker.css';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Calendar popover date picker. `value` / `onChange` are 'yyyy-MM-dd'
// strings (or null): a due date is a calendar day, not a point in time.
//   variant="input"  — bordered field (forms)
//   variant="inline" — quiet text, for label/value rows in a sheet
//   variant="badge"  — small chip; red when overdue, amber when due soon
export default function DatePicker({ value, onChange, placeholder = 'No due date', disabled = false, variant = 'input', completed = false }) {
  const menu = useMenu();
  const selected = value ? parseISO(value) : null;
  const [view, setView] = useState(() => startOfMonth(selected || new Date()));
  const [dir, setDir] = useState('next');

  useEffect(() => { if (menu.open) setView(startOfMonth(selected || new Date())); }, [menu.open]);

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(view)),
    end: endOfWeek(endOfMonth(view)),
  }), [view]);

  const step = (n) => { setDir(n > 0 ? 'next' : 'prev'); setView(m => addMonths(m, n)); };
  const pick = (d) => { onChange(format(d, 'yyyy-MM-dd')); menu.close(); };

  const away = selected ? differenceInCalendarDays(selected, startOfToday()) : null;
  const urgency = selected && !completed ? (away < 0 ? 'late' : away <= 2 ? 'soon' : '') : '';
  const label = selected ? format(selected, variant === 'badge' ? 'MMM d' : 'MMM d, yyyy') : placeholder;

  let trigger;
  if (variant === 'inline') {
    trigger = (
      <button ref={menu.anchorRef} type="button" className={`meta-btn ${selected ? `dp-inline-${urgency}` : 't-3'}`} onClick={() => !disabled && menu.toggle()} disabled={disabled}>
        {label}
      </button>
    );
  } else if (variant === 'badge') {
    trigger = (
      <button ref={menu.anchorRef} type="button" className={`dp-badge ${urgency ? `dp-badge-${urgency}` : ''}`} onClick={(e) => { e.stopPropagation(); if (!disabled) menu.toggle(); }}>
        <Icon name="calendar" size={12} />{label}
      </button>
    );
  } else {
    trigger = (
      <button ref={menu.anchorRef} type="button" className="input dp-trigger" onClick={() => !disabled && menu.toggle()} disabled={disabled}>
        <Icon name="calendar" size={14} className="t-3" />
        <span className={`truncate ${selected ? '' : 't-4'}`} style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        {value && (
          <span className="dp-clear" role="button" aria-label="Clear date" onClick={(e) => { e.stopPropagation(); onChange(null); }}>
            <Icon name="x" size={12} />
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      {trigger}
      <Menu {...menu.props} width={272} className="dp-menu">
        <div className="dp-head" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="dp-nav" onClick={() => step(-1)} aria-label="Previous month"><Icon name="chevronLeft" size={15} /></button>
          <span key={format(view, 'yyyy-MM')} className="dp-month">{format(view, 'MMMM yyyy')}</span>
          <button type="button" className="dp-nav" onClick={() => step(1)} aria-label="Next month"><Icon name="chevronRight" size={15} /></button>
        </div>
        <div className="dp-grid">
          {DOW.map(d => <span key={d} className="dp-dow">{d}</span>)}
        </div>
        <div key={format(view, 'yyyy-MM')} className={`dp-grid dp-days dp-${dir}`}>
          {days.map(d => (
            <button
              key={d.getTime()}
              type="button"
              className={[
                'dp-day',
                isSameMonth(d, view) ? '' : 'is-out',
                selected && isSameDay(d, selected) ? 'is-on' : '',
                isToday(d) ? 'is-today' : '',
              ].join(' ')}
              onClick={() => pick(d)}
            >
              {format(d, 'd')}
            </button>
          ))}
        </div>
        <div className="dp-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick(new Date())}>Today</button>
          {value && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(null); menu.close(); }}>Clear</button>}
        </div>
      </Menu>
    </>
  );
}
