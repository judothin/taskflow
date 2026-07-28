-- ============================================================
-- TaskFlow — Pet food/water as an earned inventory
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- Food and water are now per-user resources you earn by creating &
-- completing tasks and leveling up, then spend to feed/water a pet.
-- They live on user_levels (per-user, like xp). Existing users start
-- with a small stock via the column default.
-- ============================================================

alter table public.user_levels add column if not exists food  int not null default 5;
alter table public.user_levels add column if not exists water int not null default 5;

-- Done! ✅
