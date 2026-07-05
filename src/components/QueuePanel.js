import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import ContextMenu from './ContextMenu';
import './QueuePanel.css';

const ROI_COLORS = {
  critical: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.25)' },
  high:     { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: 'rgba(245,158,11,0.25)' },
  medium:   { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
  low:      { bg: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: 'rgba(34,197,94,0.25)' },
};

export default function QueuePanel() {
  const { activeTeamId } = useTeam();
  const [queue, setQueue] = useState([]);
  const [reorderingId, setReorderingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { task, x, y }

  const fetchQueue = useCallback(async () => {
    if (!activeTeamId) { setQueue([]); return; }
    const { data } = await supabase
      .from('queue')
      .select('id, task_id, position, tasks(*)')
      .eq('team_id', activeTeamId)
      .order('position');
    setQueue(data || []);
  }, [activeTeamId]);

  useEffect(() => {
    fetchQueue();

    // Realtime subscription (works if replication is enabled for the queue table)
    const channel = supabase
      .channel('queue-sidebar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, fetchQueue)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, fetchQueue)
      .subscribe();

    // Fallback: listen for the custom event fired by ContextMenu
    window.addEventListener('queue-changed', fetchQueue);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('queue-changed', fetchQueue);
    };
  }, [fetchQueue]);

  // ── Remove ────────────────────────────────────────────────────────────────

  const removeFromQueue = async (queueId) => {
    await supabase.from('queue').delete().eq('id', queueId);
    fetchQueue();
  };

  // ── Drag to reorder ───────────────────────────────────────────────────────

  const handleItemDragStart = (e, queueId) => {
    setReorderingId(queueId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', queueId);
  };

  const handleItemDragOver = (e, queueId) => {
    if (!reorderingId || queueId === reorderingId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget({ id: queueId, after });
  };

  // Drop on the "append to end" zone below the list
  const handleEndDragOver = (e) => {
    if (!reorderingId) return;
    e.preventDefault();
    setDropTarget({ id: 'end', after: false });
  };

  const commitReorder = async (reordered) => {
    setQueue(reordered);
    setReorderingId(null);
    setDropTarget(null);
    await Promise.all(
      reordered.map((q, i) =>
        supabase.from('queue').update({ position: i + 1 }).eq('id', q.id)
      )
    );
    // Let the dashboard focus bar (and any other listener) re-read the new order.
    window.dispatchEvent(new CustomEvent('queue-changed'));
  };

  const handleItemDrop = async (e, targetId) => {
    e.preventDefault();
    if (!reorderingId || reorderingId === targetId) {
      setReorderingId(null);
      setDropTarget(null);
      return;
    }

    // Recompute insert position from live event (avoids stale-closure issues)
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = e.clientY > rect.top + rect.height / 2;

    const reordered = [...queue];
    const fromIdx = reordered.findIndex(q => q.id === reorderingId);
    const [moved] = reordered.splice(fromIdx, 1);
    const toIdx = reordered.findIndex(q => q.id === targetId);
    reordered.splice(insertAfter ? toIdx + 1 : toIdx, 0, moved);

    await commitReorder(reordered);
  };

  const handleEndDrop = async (e) => {
    e.preventDefault();
    if (!reorderingId) return;

    const reordered = [...queue];
    const fromIdx = reordered.findIndex(q => q.id === reorderingId);
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.push(moved);

    await commitReorder(reordered);
  };

  const handleItemDragEnd = () => {
    setReorderingId(null);
    setDropTarget(null);
  };

  return (
    <div className="queue-panel">
      <div className="queue-header">
        <span className="queue-dot" />
        <span className="queue-title">Up Next</span>
        {queue.length > 0 && <span className="queue-count">{queue.length}</span>}
      </div>

      {queue.length === 0 ? (
        <div className="queue-empty">
          Use the <span className="queue-empty-hint">queue button</span> on any task card to add it here
        </div>
      ) : (
        <div className="queue-list">
          {queue.map((item, index) => {
            const task = item.tasks;
            if (!task) return null;
            const roi = ROI_COLORS[task.roi] || ROI_COLORS.medium;
            const isFirst = index === 0;
            const isTarget = dropTarget?.id === item.id;
            return (
              <div
                key={item.id}
                className={[
                  'queue-item',
                  isFirst                       ? 'queue-item-first'         : '',
                  reorderingId === item.id       ? 'queue-item-dragging'      : '',
                  isTarget && !dropTarget.after  ? 'queue-item-insert-before' : '',
                  isTarget &&  dropTarget.after  ? 'queue-item-insert-after'  : '',
                ].filter(Boolean).join(' ')}
                draggable
                onDragStart={e => handleItemDragStart(e, item.id)}
                onDragOver={e => handleItemDragOver(e, item.id)}
                onDrop={e => handleItemDrop(e, item.id)}
                onDragEnd={handleItemDragEnd}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ task, x: e.clientX, y: e.clientY }); }}
              >
                <span className={`queue-pos ${isFirst ? 'queue-pos-first' : ''}`}>
                  {isFirst
                    ? <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                    : index + 1}
                </span>

                <div className="queue-item-text">
                  <div className="queue-item-page">{task.page}</div>
                  <div className="queue-item-feedback">{task.feedback}</div>
                </div>

                <span className="queue-roi" style={{ background: roi.bg, color: roi.color, borderColor: roi.border }}>
                  {task.roi}
                </span>
              </div>
            );
          })}

          {/* Drop zone for appending to the end of the list */}
          {reorderingId && (
            <div
              className={`queue-drop-end ${dropTarget?.id === 'end' ? 'queue-drop-end-active' : ''}`}
              onDragOver={handleEndDragOver}
              onDragLeave={() => setDropTarget(null)}
              onDrop={handleEndDrop}
            />
          )}
        </div>
      )}

      {ctxMenu && (
        <ContextMenu
          task={ctxMenu.task}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onEdit={() => {}}
          onDeleted={fetchQueue}
        />
      )}
    </div>
  );
}
