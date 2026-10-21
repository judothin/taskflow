import React, { useRef, useState } from 'react';
import { useTeam } from '../context/TeamContext';
import { asSubtasks, makeSubtask, sortSubtasks, subtaskProgress } from '../lib/subtasks';
import { fetchSubtaskPresets, presetToSubtasks } from '../lib/subtaskPresets';
import useFlipRows from '../lib/useFlipRows';
import { Icon, Menu, useMenu } from '../ui';
import './Subtasks.css';

// The task sheet's checklist. Done items sink to the bottom (and slide there).
//   value    – [{ id, text, done }]
//   onChange – (next) => void
export default function SubtaskEditor({ value, onChange }) {
  const { activeTeamId } = useTeam();
  const list = sortSubtasks(asSubtasks(value));
  const inputs = useRef({});
  const { rowRef, capture } = useFlipRows();
  const presetMenu = useMenu();
  const [presets, setPresets] = useState(null);

  const commit = (next) => onChange(sortSubtasks(next));
  const update = (id, patch) => commit(list.map(s => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id) => { capture(); commit(list.filter(s => s.id !== id)); };
  const toggle = (s) => { capture(); update(s.id, { done: !s.done }); };
  const add = () => {
    const item = makeSubtask('');
    capture();
    commit([...list, item]);
    setTimeout(() => inputs.current[item.id]?.focus(), 0);
  };
  const onKeyDown = (e, s, i) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !s.text) {
      e.preventDefault();
      remove(s.id);
      const prev = list[i - 1];
      if (prev) setTimeout(() => inputs.current[prev.id]?.focus(), 0);
    }
  };

  const openPresets = async () => {
    presetMenu.toggle();
    if (presets === null && activeTeamId) setPresets(await fetchSubtaskPresets(activeTeamId));
  };

  const { done, total, pct } = subtaskProgress(list);

  return (
    <div className="stx">
      <div className="stx-head">
        <span className="eyebrow stx-label">Subtasks</span>
        {total > 0 ? (
          <>
            <span className="stx-track"><span className="stx-fill" style={{ width: `${pct}%` }} /></span>
            <span key={done} className="stx-count mono bump">{done}/{total}</span>
          </>
        ) : (
          <span className="stx-note">Progress shows on the card</span>
        )}
      </div>

      {list.length > 0 && (
        <div className="stx-list">
          {list.map((s, i) => (
            <div key={s.id} ref={rowRef(s.id)} className={`stx-row ${s.done ? 'is-done' : ''}`}>
              <input type="checkbox" className="check" checked={s.done} onChange={() => toggle(s)} aria-label="Done" />
              <input
                ref={el => { inputs.current[s.id] = el; }}
                className="stx-input"
                value={s.text}
                placeholder="Subtask…"
                onChange={e => update(s.id, { text: e.target.value })}
                onKeyDown={e => onKeyDown(e, s, i)}
              />
              <button type="button" className="stx-x" onClick={() => remove(s.id)} aria-label="Remove subtask">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="stx-actions">
        <button type="button" className="btn btn-ghost btn-sm stx-add" onClick={add}>
          <Icon name="plus" size={13} />Add subtask
        </button>
        <button ref={presetMenu.anchorRef} type="button" className="btn btn-ghost btn-sm" onClick={openPresets}>
          Use a preset
        </button>
      </div>

      <Menu {...presetMenu.props} width={260}>
        {presets === null && <div className="menu-label">Loading…</div>}
        {presets && presets.length === 0 && (
          <div className="stx-menu-note">No presets yet. Owners and admins add them in Settings → Subtask presets.</div>
        )}
        {(presets || []).map(p => (
          <button key={p.id} type="button" className="menu-item" data-menu-close onClick={() => commit([...list, ...presetToSubtasks(p)])}>
            <Icon name="list" size={15} />
            <span className="truncate" style={{ flex: 1 }}>{p.name}</span>
            <span className="mono t-3" style={{ fontSize: 11.5 }}>{p.items.length}</span>
          </button>
        ))}
      </Menu>
    </div>
  );
}
