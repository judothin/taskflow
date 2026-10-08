import React from 'react';
import { UI_PRESETS } from '../lib/uiPresets';

// The new UI's theme picker: one tile per preset, each a tiny drawing of the
// app (sidebar, a card, an accent button) in that preset's palette for the
// current light/dark mode. Shared by Settings and the phone's Appearance
// screen. Styled in src/modern/appearance.css — it only ever renders with
// the new UI on.
export default function UiPresetPicker({ value, mode, onChange }) {
  return (
    <div className="ui-preset-grid" role="radiogroup" aria-label="Theme">
      {UI_PRESETS.map(p => {
        const c = mode === 'light' ? p.light : p.dark;
        const on = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`ui-preset ${on ? 'ui-preset-active' : ''}`}
            onClick={() => onChange(p.id)}
          >
            <span className="ui-preset-preview" style={{ background: c.bg, borderColor: c.border }} aria-hidden="true">
              <span className="ui-preset-side" style={{ background: c.sidebar, borderColor: c.border }}>
                <span style={{ background: c.accent }} />
                <span style={{ background: c.text }} />
                <span style={{ background: c.text }} />
              </span>
              <span className="ui-preset-main">
                <span className="ui-preset-card" style={{ background: c.surface, borderColor: c.border }}>
                  <span className="ui-preset-line" style={{ background: c.text }} />
                  <span className="ui-preset-line ui-preset-line-short" style={{ background: c.text }} />
                  <span className="ui-preset-btn" style={{ background: c.accent }} />
                </span>
              </span>
            </span>
            <span className="ui-preset-name">
              <span className="ui-preset-dot" style={{ background: c.accent }} aria-hidden="true" />
              {p.label}
              {on && (
                <svg className="ui-preset-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
