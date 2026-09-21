// Subtasks / checklist helpers. A task's `subtasks` column is a JSONB array of
// { id, text, done } items (mirrors the `attachments` column pattern).

export function newSubtaskId() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeSubtask(text = '') {
  return { id: newSubtaskId(), text, done: false };
}

// Tolerant accessor — a task may predate the column (undefined) or hold junk.
export function asSubtasks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(s => s && typeof s === 'object')
    .map(s => ({ id: s.id || newSubtaskId(), text: String(s.text ?? ''), done: !!s.done }));
}

// { done, total, pct, allDone }
export function subtaskProgress(value) {
  const list = asSubtasks(value);
  const total = list.length;
  const done = list.filter(s => s.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct, allDone: total > 0 && done === total };
}

// Checked-off items sink to the bottom. Stable: within the done and not-done
// groups the author's original ordering is preserved, so toggling a box only
// ever moves that one row. Used by every checklist surface (card + detail) and
// persisted, so the stored order matches what's on screen.
export function sortSubtasks(value) {
  const list = Array.isArray(value) ? value : asSubtasks(value);
  return [...list.filter(s => !s.done), ...list.filter(s => s.done)];
}
