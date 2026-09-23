-- ============================================================
-- TaskFlow — Subtask Presets Migration
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-teams-migration.sql (it uses the
-- is_team_member / is_team_admin helpers created there).
-- ============================================================

-- A named, reusable checklist owned by a TEAM. Any member can apply one to a
-- task; only owners/admins can create, rename, or delete them.
--
-- `items` is a JSONB array of plain strings (["Draft copy", "Review", ...]) —
-- a template, so it carries no `done` flags and no ids. Applying a preset
-- mints fresh subtask rows client-side (see lib/subtaskPresets.js), which is
-- why editing a preset later never touches tasks it was already applied to.

create table if not exists public.subtask_presets (
  id         uuid default gen_random_uuid() primary key,
  team_id    uuid references public.teams(id) on delete cascade not null,
  name       text not null,
  items      jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- The only read pattern is "every preset for the active team, by name".
create index if not exists subtask_presets_team_idx
  on public.subtask_presets (team_id, name);

alter table public.subtask_presets enable row level security;

-- Drop any pre-existing policies on this table by name-agnostic sweep, so a
-- re-run can't leave a stale policy alongside the ones below (same approach
-- as section 5 of the teams migration).
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'subtask_presets'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- Read: any member of the owning team.
create policy "subtask_presets_select_member" on public.subtask_presets
  for select using (public.is_team_member(team_id));

-- Write: owners/admins only. This is the real enforcement — the Settings UI
-- hides the controls from members, but that's convenience, not security.
create policy "subtask_presets_insert_admin" on public.subtask_presets
  for insert with check (public.is_team_admin(team_id));

create policy "subtask_presets_update_admin" on public.subtask_presets
  for update using (public.is_team_admin(team_id))
  with check (public.is_team_admin(team_id));

create policy "subtask_presets_delete_admin" on public.subtask_presets
  for delete using (public.is_team_admin(team_id));
