import React from 'react';
import { Avatar, Icon, Menu, MenuItem, MenuSep, useMenu, fullName } from '../ui';
import './AssigneeSelect.css';

// Team member picker. `variant="inline"` renders as quiet text (the task
// sheet's "Assignee  Unassigned" row); the default is a bordered field.
export default function AssigneeSelect({ users = [], value, onChange, disabled = false, placeholder = 'Unassigned', variant = 'input' }) {
  const menu = useMenu();
  const selected = users.find(u => u.id === value) || null;

  const trigger = variant === 'inline' ? (
    <button
      ref={menu.anchorRef} type="button" className={`meta-btn ${selected ? '' : 't-3'}`}
      onClick={() => !disabled && menu.toggle()} disabled={disabled} aria-expanded={menu.open}
    >
      {selected && <Avatar person={selected} size={22} />}
      <span className="truncate">{selected ? fullName(selected) : placeholder}</span>
    </button>
  ) : (
    <button
      ref={menu.anchorRef} type="button" className="as-trigger input"
      onClick={() => !disabled && menu.toggle()} disabled={disabled} aria-expanded={menu.open}
    >
      {selected ? <Avatar person={selected} size={22} /> : <span className="as-empty-ico"><Icon name="user" size={12} /></span>}
      <span className={`truncate ${selected ? '' : 't-4'}`} style={{ flex: 1, textAlign: 'left' }}>{selected ? fullName(selected) : placeholder}</span>
      <Icon name="chevronDown" size={14} className={`as-chev ${menu.open ? 'is-open' : ''}`} />
    </button>
  );

  return (
    <>
      {trigger}
      <Menu {...menu.props} width={250}>
        <MenuItem icon="user" checked={!value} onClick={() => onChange('')}>Unassigned</MenuItem>
        {users.length > 0 && <MenuSep />}
        {users.map(u => (
          <button key={u.id} type="button" className="menu-item" data-menu-close onClick={() => onChange(u.id)}>
            <Avatar person={u} size={22} />
            <span className="truncate" style={{ flex: 1 }}>{fullName(u)}</span>
            {u.id === value && <Icon name="check" size={14} className="menu-check" />}
          </button>
        ))}
      </Menu>
    </>
  );
}
