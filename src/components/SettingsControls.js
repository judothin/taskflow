import React from 'react';

// Small building blocks shared by the Settings panels. They live outside the
// page so section components (which render inside it) can use the same
// controls instead of re-implementing the markup.

// Label + description on the left, control on the right.
export function SettingRow({ label, desc, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ on, onClick, disabled, label }) {
  return (
    <button
      type="button"
      className={`nc-toggle ${on ? 'nc-toggle-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={!!on}
      aria-label={label}
    >
      <span className="nc-toggle-thumb" />
    </button>
  );
}
