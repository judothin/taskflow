import React from 'react';
import '../pages/Settings.css';

// Small building blocks shared by the Settings panels (the page itself and
// the section components that render inside it — TeamSettings,
// SubtaskPresetsCard), so every row has the same 5.png layout:
// bold label + muted description on the left, the control on the right.

export function SettingRow({ label, desc, children, top, col, className = '' }) {
  return (
    <div className={`st-row ${top ? 'is-top' : ''} ${className}`}>
      <div className="st-row-text">
        <div className="st-row-label">{label}</div>
        {desc && <div className="st-row-desc">{desc}</div>}
      </div>
      <div className={`st-row-ctrl ${col ? 'is-col' : ''}`}>{children}</div>
    </div>
  );
}

/** The shared .switch, as a controlled toggle. */
export function Toggle({ on, onClick, disabled, label }) {
  return (
    <input
      type="checkbox"
      className="switch"
      role="switch"
      checked={!!on}
      onChange={() => onClick?.()}
      disabled={disabled}
      aria-checked={!!on}
      aria-label={label}
    />
  );
}

/** Range input with the accent fill drawn up to the thumb. */
export function Range({ value, min, max, step, onChange, label }) {
  const pct = ((Number(value) - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="st-range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      style={{ '--fill': `${Math.min(100, Math.max(0, pct))}%` }}
    />
  );
}
