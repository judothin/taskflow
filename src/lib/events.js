// App-wide "open this" events. The things they open (task sheet, quick
// log, context sheet, search, notifications, note scan) are mounted once,
// in the shell, so any page or button can ask for them without owning one.

export const OPEN_NEW_TASK = 'open-new-task';          // detail: prefill | undefined
export const OPEN_TASK = 'open-task';                  // detail: { id } | { task }
export const OPEN_TASK_MENU = 'open-task-menu';        // detail: { task } | { id }, x, y
export const OPEN_QUICK_LOG = 'open-quick-log';
export const OPEN_QUICK_CONTEXT = 'open-quick-context';
export const OPEN_SEARCH = 'open-global-search';
export const OPEN_NOTIFICATIONS = 'open-notifications';
export const OPEN_NOTE_SCAN = 'open-note-scan';
export const TASKS_CHANGED = 'tasks-changed';
export const QUEUE_CHANGED = 'queue-changed';

const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const openNewTask = (prefill) => fire(OPEN_NEW_TASK, prefill);
export const openTask = (taskOrId) => fire(OPEN_TASK, typeof taskOrId === 'object' ? { task: taskOrId } : { id: taskOrId });
export const openQuickLog = () => fire(OPEN_QUICK_LOG);
export const openQuickContext = () => fire(OPEN_QUICK_CONTEXT);
export const openSearch = () => fire(OPEN_SEARCH);
export const openNotifications = () => fire(OPEN_NOTIFICATIONS);
export const openNoteScan = () => fire(OPEN_NOTE_SCAN);
export const tasksChanged = () => fire(TASKS_CHANGED);
export const queueChanged = () => fire(QUEUE_CHANGED);

// Right-click menu for a task, from anywhere. Use as an onContextMenu handler:
//   onContextMenu={(e) => openTaskMenu(e, task)}
// A task object shows the menu instantly; an id works too (it's fetched).
export const openTaskMenu = (e, taskOrId) => {
  if (!taskOrId) return;
  e.preventDefault();
  e.stopPropagation();
  const ref = typeof taskOrId === 'object' ? { task: taskOrId } : { id: taskOrId };
  fire(OPEN_TASK_MENU, { ...ref, x: e.clientX, y: e.clientY });
};
