-- ============================================================
-- TaskFlow — extra XP sources (streaks + first-task-of-day)
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- Tracks each user's completion streak so we can award a daily
-- "first task of the day" + streak bonus. Critical/queue bonuses
-- need no schema (derived from the completed task).
-- ============================================================

alter table public.user_levels add column if not exists last_completed_date date;
alter table public.user_levels add column if not exists streak int not null default 0;

-- Done! ✅
