-- ============================================================
-- TaskFlow — Context Entries Migration
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-teams-migration.sql (it uses the
-- is_team_member helper created there).
-- ============================================================

-- Freeform team knowledge: things worth writing down that aren't a task, a
-- file or a project. "The captcha form is an Elementor plugin called X."
-- A subject to find it by, a description holding the actual knowledge.
--
-- Team-scoped and writable by any member, matching file_entries — this is a
-- shared notebook, and knowledge nobody can add to stops being written down.

create table if not exists public.context_entries (
  id          uuid default gen_random_uuid() primary key,
  team_id     uuid references public.teams(id) on delete cascade not null,
  subject     text not null,
  description text not null default '',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- The only read pattern is "everything for the active team, newest first".
create index if not exists context_entries_team_idx
  on public.context_entries (team_id, updated_at desc);

alter table public.context_entries enable row level security;

-- Name-agnostic sweep so a re-run can't leave a stale policy alongside the
-- ones below (same approach as section 5 of the teams migration).
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'context_entries'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

create policy "context_entries_select_team" on public.context_entries
  for select using (public.is_team_member(team_id));

create policy "context_entries_insert_team" on public.context_entries
  for insert with check (public.is_team_member(team_id));

create policy "context_entries_update_team" on public.context_entries
  for update using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));

create policy "context_entries_delete_team" on public.context_entries
  for delete using (public.is_team_member(team_id));
