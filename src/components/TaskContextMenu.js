import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { completeTask } from '../lib/completeTask';
import { fetchTeamMembers } from '../lib/teams';
import { taskTitle, pageLabel } from '../lib/taskText';
import { OPEN_TASK_MENU, openTask, tasksChanged, queueChanged } from '../lib/events';
import { Avatar, Icon, Menu, MenuSep, ConfirmDialog, toast, fullName, cap, STATUS_LABEL } from '../ui';

const now = () => new Date().toISOString();
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// One row: icon, label, and the key that does the same thing.
function Item({ icon, children, hint, danger, disabled, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item tcm-item ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-menu-close=""
    >
      <Icon name={icon} size={16} />
      <span className="truncate" style={{ flex: 1 }}>{children}</span>
      {hint && <span className="tcm-hint">{hint}</span>}
    </button>
  );
}

/**
 * The right-click menu for any task, anywhere. Mounted once in the shell;
 * rows open it with openTaskMenu(e, task) from lib/events.
 *
 * "Complete as" credits you by default. Click avatars to choose who did
 * it (one or several), then click "Complete as" (or press C).
 */
export default function TaskContextMenu() {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const [at, setAt] = useState(null);         // { x, y }
  const [task, setTask] = useState(null);
  const [queued, setQueued] = useState(null); // null = still checking
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const [completedBy, setCompletedBy] = useState([]); // names; defaults to me
  const myName = fullName(profile) || 'Someone';
  const myNameRef = useRef(myName);
  myNameRef.current = myName;

  useEffect(() => {
    let live = true;
    fetchTeamMembers(activeTeamId).then(list => { if (live) setMembers(list); });
    return () => { live = false; };
  }, [activeTeamId]);

  useEffect(() => {
    let seq = 0;
    const onOpen = async (e) => {
      const { task: t, id, x, y } = e.detail || {};
      const mine = ++seq;
      setAt({ x, y });
      setTask(t || null);
      setQueued(null);
      setCompletedBy([myNameRef.current]);
      const taskId = t?.id || id;
      const [{ data: full }, { data: q }] = await Promise.all([
        t ? Promise.resolve({ data: t }) : supabase.from('tasks').select('*').eq('id', taskId).maybeSingle(),
        supabase.from('queue').select('id').eq('task_id', taskId).limit(1),
      ]);
      if (mine !== seq) return; // a newer right-click took over
      if (!full) { setAt(null); toast('That task no longer exists', { icon: 'alert' }); return; }
      setTask(full);
      setQueued(!!q?.length);
    };
    window.addEventListener(OPEN_TASK_MENU, onOpen);
    return () => window.removeEventListener(OPEN_TASK_MENU, onOpen);
  }, []);

  const close = useCallback(() => setAt(null), []);

  // Menu wants an anchor element; a zero-size rect at the cursor stands in.
  const anchorRef = useMemo(() => ({
    current: at && {
      getBoundingClientRect: () => ({ left: at.x, right: at.x, top: at.y, bottom: at.y, width: 0, height: 0 }),
      contains: () => false,
    },
  }), [at]);
  const point = useMemo(() => (at ? { x: at.x, y: at.y } : null), [at]);

  const t = task;
  const done = t?.status === 'completed';
  const canStart = t && !done && t.status !== 'in_progress';

  const update = async (patch, message) => {
    const { error } = await supabase.from('tasks').update({ ...patch, updated_at: now() }).eq('id', t.id);
    if (error) { toast(error.message, { icon: 'alert' }); return; }
    tasksChanged();
    if (message) toast(message);
  };

  const complete = async (names) => {
    const by = names?.length ? names : [myName];
    const before = { status: t.status, completed_by: t.completed_by || null, date_completed: t.date_completed || null };
    close();
    await completeTask({ task: t, completedBy: by, userId: user?.id, teamId: activeTeamId, wasQueued: !!queued });
    toast(by.length === 1 && by[0] === myName ? 'Nice — task completed' : `Completed as ${by.join(', ')}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await supabase.from('tasks').update({ ...before, updated_at: now() }).eq('id', t.id);
          tasksChanged();
        },
      },
    });
  };

  const reopen = () => update({ status: 'open', date_completed: null, completed_by: null }, 'Task reopened');

  const start = async () => {
    // Only one task is in progress at a time: the current one goes back to open.
    await supabase.from('tasks').update({ status: 'open', updated_at: now() })
      .eq('team_id', activeTeamId).eq('status', 'in_progress').neq('id', t.id);
    await supabase.from('queue').delete().eq('task_id', t.id);
    await update({ status: 'in_progress' }, 'Started — it’s in your focus');
    queueChanged();
  };

  const toggleQueue = async () => {
    if (queued) {
      await supabase.from('queue').delete().eq('task_id', t.id);
      toast('Removed from your queue');
    } else {
      const { data: last } = await supabase.from('queue').select('position')
        .eq('team_id', activeTeamId).order('position', { ascending: false }).limit(1);
      const { error } = await supabase.from('queue')
        .insert({ task_id: t.id, team_id: activeTeamId, position: (last?.[0]?.position || 0) + 1 });
      if (error) { toast(error.message, { icon: 'alert' }); return; }
      toast('Added to your queue');
    }
    queueChanged(); tasksChanged();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tasks/${t.id}`);
      toast('Link copied');
    } catch { toast('Couldn’t copy the link', { icon: 'alert' }); }
  };

  const remove = async () => {
    setBusy(true);
    await supabase.from('queue').delete().eq('task_id', confirmDel.id);
    const { error } = await supabase.from('tasks').delete().eq('id', confirmDel.id);
    setBusy(false);
    setConfirmDel(null);
    if (error) { toast(error.message, { icon: 'alert' }); return; }
    tasksChanged(); queueChanged();
    toast('Task deleted');
  };

  // Toggle who gets credit. Always keep at least one person.
  const pickPerson = (name) => setCompletedBy(prev => (prev.includes(name)
    ? (prev.length > 1 ? prev.filter(n => n !== name) : prev)
    : [...prev, name]));

  // The hints are real: while the menu is open, the keys do what they say.
  const actions = useRef({});
  actions.current = { t, done, canStart, queued, completedBy, complete, reopen, start, toggleQueue, copyLink, close };
  useEffect(() => {
    if (!at) return undefined;
    const onKey = (e) => {
      const a = actions.current;
      if (!a.t) return;
      const k = e.key.toLowerCase();
      const run = (fn) => { e.preventDefault(); e.stopPropagation(); a.close(); fn(); };
      if ((e.metaKey || e.ctrlKey) && k === 'l') run(a.copyLink);
      else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (k === 'enter') run(() => openTask(a.t));
      else if (k === 's' && a.canStart) run(a.start);
      else if (k === 'q' && a.canStart && a.queued !== null) run(a.toggleQueue);
      else if (k === 'c') run(a.done ? a.reopen : () => a.complete(a.completedBy));
      else if (k === 'backspace' || k === 'delete') run(() => setConfirmDel(a.t));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [at]);

  const meta = t ? [pageLabel(t.page), STATUS_LABEL[t.status] || cap(t.status), cap(t.roi || 'medium')].filter(Boolean) : [];
  const several = completedBy.length > 1;

  return (
    <>
      <Menu anchorRef={anchorRef} open={!!at} onClose={close} width={340} point={point} className="tcm">
        <div className="tcm-head">
          <div className="tcm-title">{t ? taskTitle(t) : 'Loading…'}</div>
          {meta.length > 0 && <div className="tcm-meta truncate">{meta.join(' · ')}</div>}
        </div>
        <MenuSep />
        <Item icon="arrowUpRight" hint="↵" disabled={!t} onClick={() => openTask(t)}>Open</Item>
        {canStart && <Item icon="play" hint="S" onClick={start}>Start now</Item>}
        {canStart && (
          <Item icon="queue" hint="Q" disabled={queued === null} onClick={toggleQueue}>
            {queued ? 'Remove from queue' : 'Add to queue'}
          </Item>
        )}
        {done ? (
          <Item icon="undo" hint="C" onClick={reopen}>Reopen</Item>
        ) : (
          <div className="tcm-complete">
            <button
              type="button"
              className="menu-item tcm-item tcm-complete-btn"
              disabled={!t}
              onClick={() => complete(completedBy)}
              title={`Complete as ${completedBy.join(', ')}`}
            >
              <Icon name="done" size={16} />
              <span className="truncate">
                Complete as
                {completedBy.length > 0 && (several || completedBy[0] !== myName) && (
                  <span className="tcm-complete-who"> {several ? `${completedBy.length} people` : String(completedBy[0]).split(' ')[0]}</span>
                )}
              </span>
              <span className="tcm-hint">C</span>
            </button>
            <div className="tcm-people" role="group" aria-label="Complete as">
              {(members.length ? members : [profile].filter(Boolean)).map(u => {
                const name = fullName(u);
                const on = completedBy.includes(name);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`tcm-person ${on ? 'is-on' : ''}`}
                    title={name}
                    aria-label={`Credit ${name}`}
                    aria-pressed={on}
                    disabled={!t}
                    onClick={() => pickPerson(name)}
                  >
                    <Avatar person={u} size={30} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <MenuSep />
        <Item icon="link" hint={IS_MAC ? '⌘L' : 'Ctrl L'} disabled={!t} onClick={copyLink}>Copy link</Item>
        <Item icon="trash" hint="⌫" danger disabled={!t} onClick={() => setConfirmDel(t)}>Delete</Item>
      </Menu>
      {confirmDel && (
        <ConfirmDialog
          title="Delete this task?"
          text={`“${taskTitle(confirmDel)}” will be gone for everyone on the team. This can’t be undone.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}
