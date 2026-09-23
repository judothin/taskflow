import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { asSubtasks, makeSubtask, sortSubtasks, subtaskProgress } from '../lib/subtasks';
import useFlipRows from '../lib/useFlipRows';
import useIsPhone from '../lib/useIsPhone';
import './Subtasks.css';

// Read + quick-edit checklist shown on a TaskCard. Collapsed by default to a
// progress bar; expands to an interactive list where boxes can be toggled and
// new subtasks added inline. Every change persists the whole `subtasks` array
// back to the task (same pattern as FeedbackContent).
export default function TaskSubtasks({ taskId, subtasks, onChanged, defaultExpanded = false }) {
  // Ticking a box is the companion's whole point, so that stays on a phone.
  // Authoring new subtasks is editing, so the add affordance doesn't.
  const canAdd = !useIsPhone();
  const [list, setList] = useState(() => sortSubtasks(asSubtasks(subtasks)));
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const { rowRef, capture } = useFlipRows();

  useEffect(() => { setList(sortSubtasks(asSubtasks(subtasks))); }, [subtasks]);

  const { done, total, pct, allDone } = subtaskProgress(list);

  const stop = (e) => e.stopPropagation();

  const persist = async (unsorted) => {
    const next = sortSubtasks(unsorted);
    setList(next); // optimistic
    if (!taskId) return;
    await supabase.from('tasks').update({ subtasks: next, updated_at: new Date().toISOString() }).eq('id', taskId);
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    onChanged?.();
  };

  const toggle = (e, id) => {
    e.stopPropagation();
    capture(); // the row is about to sink past the unchecked ones — slide it
    persist(list.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  };

  const startAdd = (e) => { e.stopPropagation(); setAdding(true); setExpanded(true); };

  const commitAdd = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    capture(); // a new row lands above the done ones, nudging them down
    persist([...list, makeSubtask(text)]);
  };

  const addRow = (
    <div className="st-card-add-row" onClick={stop}>
      <span className="st-check st-check-ghost" />
      <input
        autoFocus
        className="st-card-add-input"
        value={draft}
        placeholder="New subtask…"
        onClick={stop}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
          else if (e.key === 'Escape') { setAdding(false); setDraft(''); }
        }}
        onBlur={() => { commitAdd(); setAdding(false); }}
      />
    </div>
  );

  // No subtasks yet → just a subtle add affordance (or the input if adding).
  if (total === 0) {
    if (!canAdd) return null;
    return (
      <div className="st-card st-card-empty" onClick={stop}>
        {adding ? addRow : (
          <button type="button" className="st-card-add st-card-add-empty" onClick={startAdd}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add subtask
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="st-card" onClick={stop}>
      <button
        type="button"
        className="st-card-header"
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
      >
        <svg className={`st-card-chevron ${expanded ? 'st-card-chevron-open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className={`st-card-count ${allDone ? 'st-card-count-done' : ''}`}>{done}/{total}</span>
        <span className="st-bar">
          <span className={`st-bar-fill ${allDone ? 'st-bar-fill-done' : ''}`} style={{ width: `${pct}%` }} />
        </span>
      </button>

      {expanded && (
        <div className="st-card-list">
          {list.map(s => (
            <label key={s.id} ref={rowRef(s.id)} className={`st-card-item ${s.done ? 'st-card-item-done' : ''}`} onClick={stop}>
              <input
                type="checkbox"
                className="st-check"
                checked={s.done}
                onChange={(e) => toggle(e, s.id)}
                onClick={stop}
              />
              <span className="st-card-item-label">{s.text || '(untitled)'}</span>
            </label>
          ))}
          {!canAdd ? null : adding ? addRow : (
            <button type="button" className="st-card-add" onClick={startAdd}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add subtask
            </button>
          )}
        </div>
      )}
    </div>
  );
}
