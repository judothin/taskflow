-- ============================================================
-- TaskFlow — post date shown on every task
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- `date_received` is the date a task was posted, and the cards / task detail
-- now surface it. It already defaults to now() and is written on every create
-- path, so no new column is needed — this just fills in any older row that
-- predates the column so already-posted tasks show a date too.
-- ============================================================

update public.tasks
   set date_received = coalesce(created_at, now())
 where date_received is null;

-- Keep it filled going forward even if a row is inserted without it.
alter table public.tasks alter column date_received set default now();

-- Done! ✅
