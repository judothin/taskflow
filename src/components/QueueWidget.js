import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { WidgetHead } from './dashboardWidgets';
import './QueuePanel.css';

const ROI_COLORS = {
  critical: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.25)' },
  high:     { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: 'rgba(245,158,11,0.25)' },
  medium:   { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
  low:      { bg: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: 'rgba(34,197,94,0.25)' },
};

// Dashboard widget mirror of the nav QueuePanel. Reordering/removal here writes
// the same `position` column and fires the same `queue-changed` event, so the
// nav "Up Next" panel and the Current Focus bar both re-read the new order.
export default function QueueWidget() {
  const { activeTeamId } = useTeam();
  const [queue, setQueue] = useState([]);
  const [reorderingId, setReorderingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const fetchQueue = useCallback(async () => {
    if (!activeTeamId) { setQueue([]); return; }
    const { data } = await supabase
      .from('queue')
      .select('id, task_id, position, tasks(*)')
      .eq('team_id', activeTeamId)
      .order('position');
    setQueue((data || []).filter(q => q.tasks));
  }, [activeTeamId]);

  useEffect(() => {
    fetchQueue();
    const channel = supabase
      .channel('queue-widget')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, fetchQueue)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, fetchQueue)
      .subscribe();
    window.addEventListener('queue-changed', fetchQueue);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('queue-changed', fetchQueue);
    };
  }, [fetchQueue]);

  const broadcast = () => window.dispatchEvent(new CustomEvent('queue-changed'));

  const removeFromQueue = async (queueId) => {
    setQueue(prev => prev.filter(q => q.id !== queueId));
    await supabase.from('queue').delete().eq('id', queueId);
    broadcast();
  };

  // ── Drag to reorder (same mechanics as QueuePanel) ────────
  const handleDragStart = (e, queueId) => {
    setReorderingId(queueId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(queueId));
  };

  const handleDragOver = (e, queueId) => {
    if (!reorderingId || queueId === reorderingId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget({ id: queueId, after });
  };

  const commitReorder = async (reordered) => {
    setQueue(reordered);
    setReorderingId(null);
    setDropTarget(null);
    await Promise.all(
      reordered.map((q, i) => supabase.from('queue').update({ position: i + 1 }).eq('id', q.id))
    );
    broadcast();
  };

  const handleDrop = async (e, targetId) => {
    e.preventDefault();
    if (!reorderingId || reorderingId === targetId) { setReorderingId(null); setDropTarget(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = e.clientY > rect.top + rect.height / 2;
    const reordered = [...queue];
    const fromIdx = reordered.findIndex(q => q.id === reorderingId);
    const [moved] = reordered.splice(fromIdx, 1);
    const toIdx = reordered.findIndex(q => q.id === targetId);
    reordered.splice(insertAfter ? toIdx + 1 : toIdx, 0, moved);
    await commitReorder(reordered);
  };

  const handleEndDragOver = (e) => { if (!reorderingId) return; e.preventDefault(); setDropTarget({ id: 'end', after: false }); };
  const handleEndDrop = async (e) => {
    e.preventDefault();
    if (!reorderingId) return;
    const reordered = [...queue];
    const fromIdx = reordered.findIndex(q => q.id === reorderingId);
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.push(moved);
    await commitReorder(reordered);
  };

  const handleDragEnd = () => { setReorderingId(null); setDropTarget(null); };

  return (
    <>
      <WidgetHead
        icon="M3 6h18 M3 12h18 M3 18h12"
        title="Queue"
        action={queue.length > 0 ? <span className="widget-count">{queue.length}</span> : null}
      />
      {queue.length === 0 ? (
        <p className="widget-empty">Use the queue button on any task card to add it here.</p>
      ) : (
        <div className="queue-list qw-list">
          {queue.map((item, index) => {
            const task = item.tasks;
            const roi = ROI_COLORS[task.roi] || ROI_COLORS.medium;
            const isFirst = index === 0;
            const isTarget = dropTarget?.id === item.id;
            return (
              <div
                key={item.id}
                className={[
                  'queue-item',
                  isFirst                      ? 'queue-item-first'         : '',
                  reorderingId === item.id      ? 'queue-item-dragging'      : '',
                  isTarget && !dropTarget.after ? 'queue-item-insert-before' : '',
                  isTarget &&  dropTarget.after ? 'queue-item-insert-after'  : '',
                ].filter(Boolean).join(' ')}
                draggable
                onDragStart={e => handleDragStart(e, item.id)}
                onDragOver={e => handleDragOver(e, item.id)}
                onDrop={e => handleDrop(e, item.id)}
                onDragEnd={handleDragEnd}
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

                <button
                  className="queue-remove"
                  title="Remove from queue"
                  aria-label="Remove from queue"
                  onClick={() => removeFromQueue(item.id)}
                  onDragStart={e => e.preventDefault()}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}

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
    </>
  );
}
