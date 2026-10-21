import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { useAuth } from '../context/AuthContext';
import { awardTaskCompletedXp } from '../lib/xp';
import { Avatar, Icon, Dialog, ConfirmDialog, fullName } from '../ui';
import './BulkActionBar.css';

const now = () => new Date().toISOString();

// Portal straight to <body> so the fixed bar escapes any ancestor transform/
// overflow, but WITHOUT the scroll-lock that ModalPortal imposes — the page
// must stay scrollable while a selection is active.
function BarPortal({ children }) {
  const elRef = useRef(null);
  if (!elRef.current) {
    elRef.current = document.createElement('div');
    elRef.current.className = 'bulk-bar-portal';
  }
  useEffect(() => {
    const el = elRef.current;
    document.body.appendChild(el);
    return () => { if (el.parentNode) el.parentNode.removeChild(el); };
  }, []);
  return createPortal(children, elRef.current);
}

// Floating action bar while tasks are selected: queue, complete or delete
// them all at once.
export default function BulkActionBar({ selectedTasks = [], users = [], onChanged, onClear, onExit }) {
  const { activeTeamId } = useTeam();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completedBy, setCompletedBy] = useState([]);
  const popoverRef = useRef(null);

  const count = selectedTasks.length;

  // Reset transient UI whenever the selection changes out from under us.
  useEffect(() => {
    setConfirmDelete(false);
    setCompleteOpen(false);
    setCompletedBy([]);
  }, [count]);


  if (count === 0) return null;

  const queueableCount = selectedTasks.filter(t => t.status !== 'in_progress' && t.status !== 'completed').length;
  const completableCount = selectedTasks.filter(t => t.status !== 'completed').length;

  const finish = () => { onClear?.(); onChanged?.(); };

  // ── Add to queue ──────────────────────────────────────────
  // If nothing is in progress, promote the first queueable task directly
  // (matching the single-card rule) and queue the rest; otherwise append
  // everything to the end of the queue, skipping anything already queued.
  const handleQueue = async () => {
    if (busy) return;
    const queueable = selectedTasks.filter(t => t.status !== 'in_progress' && t.status !== 'completed');
    if (!queueable.length) return;
    setBusy(true);

    const { data: inProgress } = await supabase
      .from('tasks').select('id').eq('team_id', activeTeamId).eq('status', 'in_progress').limit(1);

    let toQueue = queueable;
    if (!inProgress || inProgress.length === 0) {
      const first = queueable[0];
      await supabase.from('tasks')
        .update({ status: 'in_progress', updated_at: now() }).eq('id', first.id);
      toQueue = queueable.slice(1);
    }

    if (toQueue.length) {
      const [{ data: positions }, { data: existing }] = await Promise.all([
        supabase.from('queue').select('position').eq('team_id', activeTeamId).order('position', { ascending: false }).limit(1),
        supabase.from('queue').select('task_id').eq('team_id', activeTeamId),
      ]);
      let pos = positions && positions.length > 0 ? positions[0].position : 0;
      const already = new Set((existing || []).map(e => e.task_id));
      const rows = toQueue
        .filter(t => !already.has(t.id))
        .map(t => ({ task_id: t.id, team_id: activeTeamId, position: ++pos }));
      if (rows.length) await supabase.from('queue').insert(rows);
    }

    window.dispatchEvent(new CustomEvent('queue-changed'));
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    setBusy(false);
    finish();
  };

  // ── Complete ──────────────────────────────────────────────
  const togglePerson = (name) => {
    setCompletedBy(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleComplete = async () => {
    if (busy || !completedBy.length) return;
    const completable = selectedTasks.filter(t => t.status !== 'completed');
    if (!completable.length) { setCompleteOpen(false); return; }
    setBusy(true);

    const ids = completable.map(t => t.id);
    await supabase.from('tasks').update({
      status: 'completed',
      completed_by: completedBy.join(', '),
      date_completed: now(),
      updated_at: now(),
    }).in('id', ids);

    // Sequential (not forEach) so per-user XP + first-of-day bonuses
    // accumulate correctly instead of racing on the same user_levels row.
    for (const t of completable) {
      await awardTaskCompletedXp(user?.id, t.complexity, { roi: t.roi, status: t.status, wasQueued: t.status === 'in_progress' });
    }
    await supabase.from('queue').delete().in('task_id', ids);

    // If we just completed whatever was in progress, promote the next queued
    // task so the focus queue never stalls empty.
    if (completable.some(t => t.status === 'in_progress')) {
      const { data: stillIP } = await supabase
        .from('tasks').select('id').eq('team_id', activeTeamId).eq('status', 'in_progress').limit(1);
      if (!stillIP || stillIP.length === 0) {
        const { data: nextItems } = await supabase
          .from('queue').select('id, task_id').eq('team_id', activeTeamId).order('position').limit(1);
        if (nextItems && nextItems.length > 0) {
          const next = nextItems[0];
          await Promise.all([
            supabase.from('tasks').update({ status: 'in_progress', updated_at: now() }).eq('id', next.task_id),
            supabase.from('queue').delete().eq('id', next.id),
          ]);
        }
      }
      window.dispatchEvent(new CustomEvent('queue-changed'));
    }

    window.dispatchEvent(new CustomEvent('tasks-changed'));
    setBusy(false);
    setCompleteOpen(false);
    setCompletedBy([]);
    finish();
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    const ids = selectedTasks.map(t => t.id);
    await supabase.from('queue').delete().in('task_id', ids);
    await supabase.from('tasks').delete().in('id', ids);
    window.dispatchEvent(new CustomEvent('queue-changed'));
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    setBusy(false);
    setConfirmDelete(false);
    finish();
  };

  return (
    <BarPortal>
      <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
        <span className="bulk-count"><b key={count} className="bump">{count}</b> selected</span>
        <span className="bulk-sep" />
        <button type="button" className="bulk-btn" onClick={handleQueue} disabled={busy || queueableCount === 0}>
          <Icon name="queue" size={15} /><span className="hide-phone">Add to queue</span>
        </button>
        <button type="button" className="bulk-btn" onClick={() => setCompleteOpen(true)} disabled={busy || completableCount === 0}>
          <Icon name="check" size={15} /><span className="hide-phone">Complete</span>
        </button>
        <button type="button" className="bulk-btn bulk-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
          <Icon name="trash" size={15} /><span className="hide-phone">Delete</span>
        </button>
        <span className="bulk-sep" />
        <button type="button" className="bulk-btn" onClick={onExit || onClear} aria-label="Clear selection"><Icon name="x" size={15} /></button>
      </div>

      {completeOpen && (
        <Dialog
          title={`Complete ${completableCount} task${completableCount === 1 ? '' : 's'}`}
          text="Who completed them?"
          onClose={() => { setCompleteOpen(false); setCompletedBy([]); }}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => { setCompleteOpen(false); setCompletedBy([]); }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleComplete} disabled={busy || !completedBy.length}>
                {busy ? <span className="spinner" /> : 'Mark complete'}
              </button>
            </>
          )}
        >
          <div className="bulk-people stagger" ref={popoverRef}>
            {users.map(u => {
              const name = fullName(u);
              const on = completedBy.includes(name);
              return (
                <button key={u.id} type="button" className={`bulk-person ${on ? 'is-on' : ''}`} onClick={() => togglePerson(name)}>
                  <Avatar person={u} size={28} />
                  <span className="truncate" style={{ flex: 1 }}>{name}</span>
                  <span className={`check-round ${on ? 'is-on' : ''}`} />
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${count} task${count === 1 ? '' : 's'}?`}
          text="They’re removed for the whole team. This can’t be undone."
          confirmLabel="Delete"
          danger busy={busy}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </BarPortal>
  );
}
