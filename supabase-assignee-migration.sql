-- ============================================================
-- TaskFlow — Task Assignee
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- Optional team member responsible for a task. Nullable/optional by
-- design — most tasks are unassigned until someone picks them up.
-- Set null on delete (like created_by) so removing a team member never
-- blocks their deletion or orphans the task.
alter table public.tasks add column if not exists assignee_id uuid references public.profiles(id) on delete set null;

-- Done! ✅ Existing RLS policies on public.tasks (tasks_select_authenticated /
-- tasks_update_authenticated, or the team-scoped versions from
-- supabase-teams-migration.sql) already cover this column — no new policy
-- needed since it's just another field on the same row.
