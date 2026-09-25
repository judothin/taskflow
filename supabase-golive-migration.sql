-- ============================================================
-- TaskFlow — Go Live list Migration
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-teams-migration.sql (it uses the
-- is_team_member helper created there).
-- ============================================================

-- Work that's done on dev and still has to be pushed to live. One row per
-- change: the page it's on, what changed, and the files that have to go up
-- with it.
--
-- `files` is deliberately plain text, not links into file_entries: it's a
-- deploy note, one file per line with whatever needs knowing about it
-- ("header.php — new nav markup, needs the matching CSS").
--
-- Marking an item live keeps the row (status = 'live') rather than deleting
-- it, so it can be restored if it was ticked off by mistake.

create table if not exists public.golive_items (
  id           uuid default gen_random_uuid() primary key,
  team_id      uuid references public.teams(id) on delete cascade not null,
  page         text not null,
  description  text not null default '',
  files        text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'live')),
  went_live_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- The only read pattern is "everything for the active team, newest first".
create index if not exists golive_items_team_idx
  on public.golive_items (team_id, status, created_at desc);

alter table public.golive_items enable row level security;

-- Name-agnostic sweep so a re-run can't leave a stale policy alongside the
-- ones below (same approach as section 5 of the teams migration).
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'golive_items'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- A shared team list: any member can add, edit, tick off and remove.
create policy "golive_items_select_team" on public.golive_items
  for select using (public.is_team_member(team_id));

create policy "golive_items_insert_team" on public.golive_items
  for insert with check (public.is_team_member(team_id));

create policy "golive_items_update_team" on public.golive_items
  for update using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));

create policy "golive_items_delete_team" on public.golive_items
  for delete using (public.is_team_member(team_id));

-- Make the new table visible to the API straight away.
notify pgrst, 'reload schema';
