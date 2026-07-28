-- ============================================================
-- TaskFlow — task-achievement badges
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- Counts how many tasks a user has completed, for the Tasks rank
-- track. Incremented client-side on each completion; backfilled
-- here from existing completed tasks the user created.
-- ============================================================

alter table public.user_levels add column if not exists tasks_completed int not null default 0;

update public.user_levels ul
set tasks_completed = coalesce(
  (select count(*) from public.tasks t where t.created_by = ul.user_id and t.status = 'completed'), 0)
where tasks_completed = 0;

-- Done! ✅
