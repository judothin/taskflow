import { supabase } from './supabase';
import { awardTaskCompletedXp } from './xp';
import { bumpTeamStreak } from './streak';

// Marking a task done is more than a status write: it awards XP, bumps the
// team streak, drops the task out of the queue, and — if it was the task in
// progress — promotes whatever was next in the queue to take its place.
//
// This lives here because two surfaces do it: the desktop TaskCard's quick
// complete, and the mobile companion's row. Duplicating the sequence would
// mean one of them eventually forgetting a step (the queue promotion is the
// easy one to miss).
export async function completeTask({ task, completedBy, userId, teamId, wasQueued = false }) {
  if (!task || !completedBy?.length) return;
  const now = new Date().toISOString();

  await supabase.from('tasks').update({
    status: 'completed',
    completed_by: completedBy.join(', '),
    date_completed: now,
    updated_at: now,
  }).eq('id', task.id);

  awardTaskCompletedXp(userId, task.complexity, {
    roi: task.roi,
    status: task.status,
    wasQueued: wasQueued || task.status === 'in_progress',
  });
  bumpTeamStreak(teamId);

  await supabase.from('queue').delete().eq('task_id', task.id);

  // Finishing the in-progress task pulls the next queued one into its place,
  // so there's always something current without anyone picking it by hand.
  if (task.status === 'in_progress') {
    const { data: nextItems } = await supabase
      .from('queue').select('id, task_id').eq('team_id', teamId).order('position').limit(1);
    if (nextItems && nextItems.length > 0) {
      const next = nextItems[0];
      await Promise.all([
        supabase.from('tasks').update({ status: 'in_progress', updated_at: now }).eq('id', next.task_id),
        supabase.from('queue').delete().eq('id', next.id),
      ]);
    }
    window.dispatchEvent(new CustomEvent('queue-changed'));
  }

  // Let any mounted view (activity chart, counts, other lists) update live.
  window.dispatchEvent(new CustomEvent('tasks-changed'));
}
