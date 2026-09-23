import React, { useEffect, useState } from 'react';
import { useTeam } from '../context/TeamContext';
import { fetchSubtaskPresets, presetToSubtasks } from '../lib/subtaskPresets';

// "Add subtask preset" control for SubtaskEditor — drops a team's saved
// checklist into the task being created or edited.
//
// The list expands inline rather than as an absolutely-positioned popover
// because this lives mid-form inside `.modal-body`, which is an
// `overflow-y: auto` scroll container: a floating menu would be clipped at
// the modal's edge whenever the subtasks field sits near the bottom of the
// visible area.
export default function SubtaskPresetPicker({ onApply }) {
  const { activeTeamId } = useTeam();
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState(null); // null = not fetched yet
  const [loading, setLoading] = useState(false);

  // Presets load on first open, not on mount — otherwise every task form
  // would query the table whether or not anyone touches presets.
  useEffect(() => { setPresets(null); setOpen(false); }, [activeTeamId]);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (presets !== null || !activeTeamId) return;
    setLoading(true);
    try { setPresets(await fetchSubtaskPresets(activeTeamId)); }
    finally { setLoading(false); }
  };

  const choose = (preset) => {
    onApply(presetToSubtasks(preset));
    setOpen(false);
  };

  const list = presets || [];

  return (
    <div className="st-preset">
      <button
        type="button"
        className={`st-editor-add ${open ? 'st-preset-trigger-open' : ''}`}
        onClick={toggle}
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 20 6" />
          <path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" />
        </svg>
        Add subtask preset
      </button>

      {open && (
        <div className="st-preset-panel">
          {loading && <div className="st-preset-note">Loading presets…</div>}

          {!loading && !activeTeamId && (
            <div className="st-preset-note">Join or create a team to use presets.</div>
          )}

          {!loading && activeTeamId && list.length === 0 && (
            <div className="st-preset-note">
              No presets yet. A team owner or admin can add them in
              {' '}<strong>Settings → Subtask Presets</strong>.
            </div>
          )}

          {!loading && list.map(p => (
            <button key={p.id} type="button" className="st-preset-option" onClick={() => choose(p)}>
              <span className="st-preset-option-name">{p.name}</span>
              <span className="st-preset-option-count">
                {p.items.length} step{p.items.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
