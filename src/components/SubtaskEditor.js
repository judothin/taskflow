import React, { useRef } from 'react';
import { asSubtasks, makeSubtask, subtaskProgress } from '../lib/subtasks';
import './Subtasks.css';

// Controlled checklist editor used inside TaskForm / TaskDetail.
//   value    – array of { id, text, done }
//   onChange – (nextArray) => void
export default function SubtaskEditor({ value, onChange }) {
  const list = asSubtasks(value);
  const rowRefs = useRef({});

  const commit = (next) => onChange(next);

  const update = (id, patch) => commit(list.map(s => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id) => commit(list.filter(s => s.id !== id));

  const add = (focus = true) => {
    const item = makeSubtask('');
    commit([...list, item]);
    if (focus) setTimeout(() => rowRefs.current[item.id]?.focus(), 0);
  };

  const onKeyDown = (e, id, idx) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !list[idx].text) {
      // Backspace on an empty row removes it and focuses the previous one.
      e.preventDefault();
      remove(id);
      const prev = list[idx - 1];
      if (prev) setTimeout(() => rowRefs.current[prev.id]?.focus(), 0);
    }
  };

  const { done, total } = subtaskProgress(list);

  return (
    <div className="st-editor">
      {list.map((s, idx) => (
        <div key={s.id} className={`st-editor-row ${s.done ? 'st-editor-row-done' : ''}`}>
          <input
            type="checkbox"
            className="st-check"
            checked={s.done}
            onChange={() => update(s.id, { done: !s.done })}
          />
          <input
            ref={el => { rowRefs.current[s.id] = el; }}
            className="st-editor-input"
            value={s.text}
            placeholder="Subtask…"
            onChange={e => update(s.id, { text: e.target.value })}
            onKeyDown={e => onKeyDown(e, s.id, idx)}
          />
          <button type="button" className="st-editor-remove" onClick={() => remove(s.id)} title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}

      <button type="button" className="st-editor-add" onClick={() => add()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add subtask
      </button>

      {total > 0 && <span className="st-editor-progress">{done} / {total} done</span>}
    </div>
  );
}
