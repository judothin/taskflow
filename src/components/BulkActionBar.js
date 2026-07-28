import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { useAuth } from '../context/AuthContext';
import { awardTaskCompletedXp } from '../lib/xp';
import Avatar from './Avatar';
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

// Floating action bar shown while one or more task cards are selected.
// Mirrors the single-card queue/complete/delete behaviour in TaskCard,
// applied to every selected task at once.
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

  useEffect(() => {
    if (!completeOpen) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setCompleteOpen(false);
        setCompletedBy([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [completeOpen]);

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

    // Sequential (not forEach) so per-user XP + streak/first-of-day bonuses
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
        <div className="bulk-bar-count">
          <span className="bulk-bar-count-num">{count}</span>
          selected
        </div>

        <div className="bulk-bar-divider" />

        <div className="bulk-bar-actions">
          {/* Add to queue */}
          <button
            className="bulk-bar-btn"
            onClick={handleQueue}
            disabled={busy || queueableCount === 0}
            title={queueableCount === 0 ? 'None can be queued' : `Add ${queueableCount} to queue`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Add to Queue
          </button>

          {/* Complete */}
          <div style={{ position: 'relative' }}>
            <button
              className={`bulk-bar-btn ${completeOpen ? 'bulk-bar-btn-active' : ''}`}
              onClick={() => { setCompleteOpen(v => !v); setCompletedBy([]); setConfirmDelete(false); }}
              disabled={busy || completableCount === 0}
              title={completableCount === 0 ? 'All already completed' : `Complete ${completableCount}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              Complete
            </button>

            {completeOpen && (
              <div className="complete-popover bulk-complete-popover" ref={popoverRef}>
                <p className="complete-popover-label">
                  Completed by
                  {completedBy.length > 0 && <span className="complete-popover-count">{completedBy.length}</span>}
                </p>
                <div className="complete-popover-people">
                  {users.map(u => {
                    const name = `${u.first_name} ${u.last_name}`;
                    const checked = completedBy.includes(name);
                    return (
                      <label key={u.id} className={`complete-person-row ${checked ? 'complete-person-row-checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => togglePerson(name)} className="complete-person-checkbox" />
                        <Avatar src={u.avatar_url} color={u.color || '#6366f1'} initials={`${u.first_name[0]}${u.last_name[0]}`} size={28} style={{ flexShrink: 0 }} />
                        <span className="complete-person-name">{u.first_name} {u.last_name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="complete-popover-actions">
                  <button
                    className="task-action-btn task-action-btn-confirm"
                    onClick={handleComplete}
                    disabled={!completedBy.length || busy}
                    style={{ width: '100%' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {busy ? 'Saving…' : `Complete ${completableCount}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Delete */}
          {!confirmDelete ? (
            <button
              className="bulk-bar-btn bulk-bar-btn-danger"
              onClick={() => { setConfirmDelete(true); setCompleteOpen(false); }}
              disabled={busy}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6 M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
              Delete
            </button>
          ) : (
            <div className="bulk-bar-confirm">
              <span>Delete {count}?</span>
              <button className="bulk-bar-btn bulk-bar-btn-danger" onClick={handleDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button className="bulk-bar-btn" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</button>
            </div>
          )}
        </div>

        <button className="bulk-bar-close" onClick={() => (onExit || onClear)?.()} title="Exit select mode" aria-label="Exit select mode">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </BarPortal>
  );
}
