-- ============================================================
-- TaskFlow — Sidebar nav customization (rearrange + show/hide)
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- Stores an ordered array of { id, visible } — same idea as dashboard_layout,
-- just for the sidebar nav instead of the dashboard widgets.
alter table public.user_preferences add column if not exists nav_layout jsonb;
