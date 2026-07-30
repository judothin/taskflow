-- ============================================================
-- TaskFlow — editable member start date (e.g. hire date)
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- Drives the tenure ("membership length") rank badges. Falls back to the
-- account creation date when not set. Users edit their own in Settings.
-- ============================================================

alter table public.profiles add column if not exists start_date date;

-- Done! ✅
