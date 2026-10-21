import React from 'react';
import { Icon } from '../ui';
import './ColorSwatches.css';

// The people colours (chart colour / avatar fallback). Shared by Settings ›
// Profile and Register.
export const PERSON_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#171717',
];

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

/**
 * A row of round colour swatches. The picked one gets a ring that springs in.
 *   options   [{ value, label }] or plain hex strings. A value of '' is the
 *             "default" swatch and is painted with `defaultClass`.
 *   custom    show a trailing custom-colour picker
 *   onCustom  live callback while dragging the native picker (defaults to onChange)
 */
export default function ColorSwatches({
  value, onChange, options = PERSON_COLORS, custom = false, onCustom, label = 'Colour', defaultClass = 'sw-ink',
}) {
  const opts = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const isCustom = custom && !!value && !opts.some(o => same(o.value, value));
  return (
    <div className="sw-row" role="radiogroup" aria-label={label}>
      {opts.map((o, i) => {
        const on = o.value ? same(o.value, value) : !value;
        return (
          <button
            key={o.value || 'default'}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            className={`sw ${on ? 'is-on' : ''} ${o.value ? '' : defaultClass}`}
            style={{ '--sw': o.value || undefined, '--i': i }}
            onClick={() => onChange(o.value)}
          >
            {on && <Icon name="check" size={13} stroke={2.6} className="sw-check" />}
          </button>
        );
      })}
      {custom && (
        <label
          className={`sw sw-custom ${isCustom ? 'is-on' : ''}`}
          style={{ '--sw': isCustom ? value : undefined, '--i': opts.length }}
          title="Custom colour"
        >
          {isCustom ? <Icon name="check" size={13} stroke={2.6} className="sw-check" /> : <Icon name="plus" size={14} />}
          <input
            type="color"
            className="sw-native"
            value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#6366f1'}
            onChange={(e) => (onCustom || onChange)(e.target.value)}
            aria-label="Custom colour"
          />
        </label>
      )}
    </div>
  );
}
