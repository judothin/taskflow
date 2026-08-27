-- ============================================================
-- TaskFlow — REMOVE PETS
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- Drops everything pet-related. Levels/XP, streaks, tasks_completed, and the
-- rank/achievement badges are kept — only pets are removed.
--
-- ⚠ This permanently deletes pet data. Back up first if you want it.
-- ============================================================

-- Pet unlock / sacrifice RPCs (no-arg security-definer functions).
drop function if exists public.claim_pet_unlock() cascade;
drop function if exists public.sacrifice_for_new_pet() cascade;

-- Pet tables (RLS policies drop with the tables).
drop table if exists public.pets cascade;
drop table if exists public.pet_environments cascade;

-- Pet-only columns on user_levels (keep level, xp, tasks_completed, streak,
-- last_completed_date, gamification_enabled, gamification_choice_made).
alter table public.user_levels drop column if exists food;
alter table public.user_levels drop column if exists water;
alter table public.user_levels drop column if exists pending_pet_unlocks;

-- Optional: reclaim any uploaded pet-environment images from storage.
-- (Uncomment to run — removes objects under the pet-environments/ prefix.)
-- delete from storage.objects
--   where bucket_id = 'task-images' and name like 'pet-environments/%';

-- Done! ✅
