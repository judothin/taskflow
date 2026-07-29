-- ============================================================
-- TaskFlow — Task Due Date
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- Optional due date. Plain `date` (not timestamptz) — a due date is a
-- calendar day, not a point in time, so there's no time-of-day/timezone
-- to reconcile when reading/writing it.
alter table public.tasks add column if not exists due_date date;

-- Done! ✅ Existing RLS policies on public.tasks already cover this column —
-- no new policy needed, same as assignee_id in supabase-assignee-migration.sql.
