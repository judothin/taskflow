import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import './ContextMenu.css';

export default function ContextMenu({ task, x, y, onClose, onEdit, onDeleted }) {
  const { activeTeamId } = useTeam();
  const navigate = useNavigate();
  const [isQueued, setIsQueued] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    supabase
      .from('queue')
      .select('id')
      .eq('task_id', task.id)
      .then(({ data }) => setIsQueued(!!(data && data.length > 0)));
  }, [task.id]);

  // Close on click outside or Escape
  useEffect(() => {
    const onMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Keep menu inside viewport
  const left = Math.min(x, window.innerWidth - 210);
  const top  = Math.min(y, window.innerHeight - 270);

  const canQueue = task.status !== 'in_progress' && task.status !== 'completed';

  const notifyQueueChanged = () => window.dispatchEvent(new CustomEvent('queue-changed'));

  const handleAddToQueue = async () => {
    // If nothing is currently in progress, promote directly instead of queuing
    const { data: inProgress } = await supabase
      .from('tasks')
      .select('id')
      .eq('team_id', activeTeamId)
      .eq('status', 'in_progress')
      .limit(1);

    if (!inProgress || inProgress.length === 0) {
      await supabase
        .from('tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', task.id);
      onDeleted?.(); // refresh the task list on the page
    } else {
      const { data: positions } = await supabase
        .from('queue')
        .select('position')
        .eq('team_id', activeTeamId)
        .order('position', { ascending: false })
        .limit(1);
      const maxPos = positions && positions.length > 0 ? positions[0].position : 0;
      await supabase.from('queue').insert({ task_id: task.id, team_id: activeTeamId, position: maxPos + 1 });
      notifyQueueChanged();
    }
    onClose();
  };

  const handleRemoveFromQueue = async () => {
    await supabase.from('queue').delete().eq('task_id', task.id);
    notifyQueueChanged();
    onClose();
  };

  const handleDelete = async () => {
    await supabase.from('tasks').delete().eq('id', task.id);
    onDeleted?.();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ top, left }}
      onContextMenu={e => e.preventDefault()}
      onClick={e => e.stopPropagation()}
    >
      {/* Task label */}
      <div className="ctx-label">{task.page}</div>

      <button className="ctx-item" onClick={() => { onEdit(task); onClose(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit task
      </button>

      <button className="ctx-item" onClick={() => { navigate(`/tasks/${task.id}`); onClose(); }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Open task
      </button>

      {canQueue && !isQueued && (
        <button className="ctx-item" onClick={handleAddToQueue}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Add to queue
        </button>
      )}

      {isQueued && (
        <button className="ctx-item ctx-item-muted" onClick={handleRemoveFromQueue}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Remove from queue
        </button>
      )}

      <div className="ctx-divider" />

      {!confirmDelete ? (
        <button className="ctx-item ctx-item-danger" onClick={() => setConfirmDelete(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6 M14 11v6 M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
          Delete task
        </button>
      ) : (
        <div className="ctx-confirm">
          <span className="ctx-confirm-label">Delete this task?</span>
          <div className="ctx-confirm-actions">
            <button className="ctx-confirm-yes" onClick={handleDelete}>Yes, delete</button>
            <button className="ctx-confirm-no" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
