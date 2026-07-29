import React, { useState, useRef, useEffect } from 'react';
import Avatar from './Avatar';
import AnimatedPopover from './AnimatedPopover';
import './AssigneeSelect.css';

// Custom-styled replacement for a native <select> of team members — the
// native dropdown can only show plain text options (grey OS-rendered list),
// so it can't show avatars and looks out of place next to the rest of the
// app's UI. This renders like an input but opens an app-styled popover.
export default function AssigneeSelect({ users = [], value, onChange, disabled = false, placeholder = 'Unassigned' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = users.find(u => u.id === value) || null;

  const choose = (id) => { onChange(id); setOpen(false); };

  return (
    <div className="assignee-select" ref={ref}>
      <button
        type="button"
        className={`assignee-select-trigger ${disabled ? 'assignee-select-trigger-disabled' : ''}`}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
      >
        {selected ? (
          <>
            <Avatar
              src={selected.avatar_url}
              color={selected.color || '#6366f1'}
              initials={`${selected.first_name[0]}${selected.last_name[0]}`}
              size={20}
            />
            <span className="assignee-select-name">{selected.first_name} {selected.last_name}</span>
          </>
        ) : (
          <>
            <span className="assignee-select-placeholder-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="assignee-select-name assignee-select-placeholder">{placeholder}</span>
          </>
        )}
        <svg className="assignee-select-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <AnimatedPopover open={open} className="assignee-select-popover">
        <button
          type="button"
          className={`assignee-select-option ${!value ? 'assignee-select-option-active' : ''}`}
          onClick={() => choose('')}
        >
          <span className="assignee-select-option-unassigned-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </span>
          <span style={{ flex: 1 }}>Unassigned</span>
          {!value && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {users.length > 0 && <div className="assignee-select-divider" />}

        <div className="assignee-select-scroll">
          {users.map(u => {
            const active = u.id === value;
            return (
              <button
                key={u.id}
                type="button"
                className={`assignee-select-option ${active ? 'assignee-select-option-active' : ''}`}
                onClick={() => choose(u.id)}
              >
                <Avatar
                  src={u.avatar_url}
                  color={u.color || '#6366f1'}
                  initials={`${u.first_name[0]}${u.last_name[0]}`}
                  size={22}
                />
                <span style={{ flex: 1 }}>{u.first_name} {u.last_name}</span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </AnimatedPopover>
    </div>
  );
}
