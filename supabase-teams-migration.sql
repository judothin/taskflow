-- ============================================================
-- TaskFlow — Multi-Team Migration
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-schema.sql has already been applied.
-- ============================================================

-- Note: `submissions`, `queue`, `projects`, `project_comments`,
-- `project_comment_reads`, `project_reads`, and `file_entries` already exist
-- in your database but were created ad-hoc (via the dashboard), so this
-- script can't know what RLS policies are already on them. Section 5 below
-- automatically wipes ALL existing policies on every table it re-secures
-- (including `tasks`/`profiles`) before creating the new team-scoped ones —
-- so any old, broad "authenticated can see everything" policy is removed
-- rather than silently staying active alongside the new one. Nothing for
-- you to check by hand.


-- ============================================================
-- 1. TEAMS + MEMBERSHIP
-- ============================================================

create table if not exists public.teams (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  slug        text unique not null,   -- public, used in guest-portal URLs
  invite_code text unique not null,   -- secret, used to join as a member
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now()
);

create table if not exists public.team_members (
  id        uuid default gen_random_uuid() primary key,
  team_id   uuid references public.teams(id) on delete cascade not null,
  user_id   uuid references public.profiles(id) on delete cascade not null,
  role      text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz default now(),
  unique (team_id, user_id)
);

-- A public, non-secret view for the guest portal to resolve a team by its
-- slug without ever exposing invite_code or membership. Views run with the
-- privileges of their owner (postgres), so this bypasses the `teams` RLS
-- below the same way table-owner access always has — no anon policy on the
-- base table is needed.
create or replace view public.team_guest_info as
  select id, name, slug from public.teams;


-- ============================================================
-- 2. team_id ON EXISTING TABLES
-- ============================================================

alter table public.tasks          add column if not exists team_id uuid references public.teams(id);
alter table public.submissions    add column if not exists team_id uuid references public.teams(id);
alter table public.queue          add column if not exists team_id uuid references public.teams(id);
alter table public.projects       add column if not exists team_id uuid references public.teams(id);
alter table public.file_entries   add column if not exists team_id uuid references public.teams(id);

-- project_comments / project_comment_reads / project_reads intentionally do
-- NOT get their own team_id — they're scoped by joining to projects.team_id.

-- Remembers which team is "active" for a user, synced across devices the
-- same way dashboard_layout / notif_settings already are.
alter table public.user_preferences add column if not exists active_team_id uuid references public.teams(id);


-- ============================================================
-- 3. HELPER FUNCTIONS (used inside RLS policies)
-- ============================================================

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and role in ('owner','admin')
  );
$$;

create or replace function public.random_code(len int default 8)
returns text
language sql volatile
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (ceil(random()*36))::int, 1), '')
  from generate_series(1, len);
$$;


-- ============================================================
-- 4. RPCs — the only way team/membership rows get written
--    (security definer so they can run the multi-step logic safely
--    without needing a service-role key or Edge Functions)
-- ============================================================

create or replace function public.create_team(p_name text)
returns public.teams
language plpgsql security definer set search_path = public
as $$
declare
  v_team public.teams;
  v_slug text;
  v_code text;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'Team name is required';
  end if;

  loop
    v_slug := public.random_code(8);
    exit when not exists (select 1 from public.teams where slug = v_slug);
  end loop;
  loop
    v_code := upper(public.random_code(8));
    exit when not exists (select 1 from public.teams where invite_code = v_code);
  end loop;

  insert into public.teams (name, slug, invite_code, created_by)
  values (trim(p_name), v_slug, v_code, auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, auth.uid(), 'owner');

  return v_team;
end;
$$;

create or replace function public.join_team_by_code(p_code text)
returns public.teams
language plpgsql security definer set search_path = public
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'Invalid invite code';
  end if;
  if exists (select 1 from public.team_members where team_id = v_team.id and user_id = auth.uid()) then
    raise exception 'You are already a member of this team';
  end if;

  insert into public.team_members (team_id, user_id, role) values (v_team.id, auth.uid(), 'member');
  return v_team;
end;
$$;

create or replace function public.rename_team(p_team_id uuid, p_name text)
returns public.teams
language plpgsql security definer set search_path = public
as $$
declare
  v_team public.teams;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'Team name is required';
  end if;
  if not public.is_team_admin(p_team_id) then
    raise exception 'Only team owners/admins can rename the team';
  end if;
  update public.teams set name = trim(p_name) where id = p_team_id returning * into v_team;
  return v_team;
end;
$$;

create or replace function public.regenerate_invite_code(p_team_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_team_admin(p_team_id) then
    raise exception 'Only team owners/admins can regenerate the invite code';
  end if;
  loop
    v_code := upper(public.random_code(8));
    exit when not exists (select 1 from public.teams where invite_code = v_code);
  end loop;
  update public.teams set invite_code = v_code where id = p_team_id;
  return v_code;
end;
$$;

create or replace function public.set_member_role(p_team_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_role not in ('admin','member') then
    raise exception 'Invalid role';
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the team owner can change member roles';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Owners cannot change their own role';
  end if;
  update public.team_members set role = p_role
  where team_id = p_team_id and user_id = p_user_id and role <> 'owner';
end;
$$;

create or replace function public.remove_team_member(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  select role into v_caller_role from public.team_members where team_id = p_team_id and user_id = auth.uid();
  select role into v_target_role from public.team_members where team_id = p_team_id and user_id = p_user_id;

  if v_caller_role is null or v_caller_role not in ('owner','admin') then
    raise exception 'Only owners and admins can remove members';
  end if;
  if v_target_role = 'owner' then
    raise exception 'The team owner cannot be removed';
  end if;
  if v_caller_role = 'admin' and v_target_role = 'admin' then
    raise exception 'Admins cannot remove other admins';
  end if;

  delete from public.team_members where team_id = p_team_id and user_id = p_user_id;
end;
$$;


-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

-- Wipe every existing policy on every table this migration re-secures,
-- regardless of name — so nothing old (from supabase-schema.sql or from
-- clicking around the dashboard) can keep working alongside the new
-- team-scoped policies created below.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('tasks','profiles','submissions','queue','projects',
                         'project_comments','project_comment_reads','project_reads',
                         'file_entries')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.teams                  enable row level security;
alter table public.team_members            enable row level security;
alter table public.submissions             enable row level security;
alter table public.queue                   enable row level security;
alter table public.projects                enable row level security;
alter table public.project_comments        enable row level security;
alter table public.project_comment_reads   enable row level security;
alter table public.project_reads           enable row level security;
alter table public.file_entries            enable row level security;
-- tasks/profiles already had RLS enabled by supabase-schema.sql; re-running
-- ENABLE here would be a harmless no-op, so it's omitted for both.

create policy "teams_select_member" on public.teams
  for select using (public.is_team_member(id));

-- teams/team_members are otherwise only ever written to via the RPCs above
-- (security definer, so they don't need their own insert/update/delete
-- policies for regular users).

create policy "team_members_select_member" on public.team_members
  for select using (public.is_team_member(team_id));


-- ── tasks ──
create policy "tasks_select_team" on public.tasks for select using (public.is_team_member(team_id));
create policy "tasks_insert_team" on public.tasks for insert with check (public.is_team_member(team_id));
create policy "tasks_update_team" on public.tasks for update using (public.is_team_member(team_id));
create policy "tasks_delete_team" on public.tasks for delete using (public.is_team_member(team_id));


-- ── submissions ── (guest insert must stay open — no account yet)
create policy "submissions_select_team" on public.submissions for select using (public.is_team_member(team_id));
create policy "submissions_update_team" on public.submissions for update using (public.is_team_member(team_id));
create policy "submissions_insert_guest" on public.submissions for insert with check (team_id is not null);


-- ── queue ──
create policy "queue_select_team" on public.queue for select using (public.is_team_member(team_id));
create policy "queue_insert_team" on public.queue for insert with check (public.is_team_member(team_id));
create policy "queue_update_team" on public.queue for update using (public.is_team_member(team_id));
create policy "queue_delete_team" on public.queue for delete using (public.is_team_member(team_id));


-- ── projects ──
create policy "projects_select_team" on public.projects for select using (public.is_team_member(team_id));
create policy "projects_insert_team" on public.projects for insert with check (public.is_team_member(team_id));
create policy "projects_update_team" on public.projects for update using (public.is_team_member(team_id));
create policy "projects_delete_team" on public.projects for delete using (public.is_team_member(team_id));


-- ── file_entries ──
create policy "file_entries_select_team" on public.file_entries for select using (public.is_team_member(team_id));
create policy "file_entries_insert_team" on public.file_entries for insert with check (public.is_team_member(team_id));
create policy "file_entries_update_team" on public.file_entries for update using (public.is_team_member(team_id));
create policy "file_entries_delete_team" on public.file_entries for delete using (public.is_team_member(team_id));


-- ── project_comments / project_comment_reads / project_reads ──
-- (scoped by joining through projects.team_id — no team_id column of their own)
create policy "project_comments_team" on public.project_comments for all using (
  exists (select 1 from public.projects p where p.id = project_comments.project_id and public.is_team_member(p.team_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_comments.project_id and public.is_team_member(p.team_id))
);

create policy "project_comment_reads_team" on public.project_comment_reads for all using (
  exists (select 1 from public.projects p where p.id = project_comment_reads.project_id and public.is_team_member(p.team_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_comment_reads.project_id and public.is_team_member(p.team_id))
);

create policy "project_reads_team" on public.project_reads for all using (
  exists (select 1 from public.projects p where p.id = project_reads.project_id and public.is_team_member(p.team_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_reads.project_id and public.is_team_member(p.team_id))
);


-- ── profiles ── (tighten select: teammates only, not the whole user base)
-- The policy sweep above also removes profiles_insert/profiles_update from
-- supabase-schema.sql (it drops every policy on this table, not just the
-- old select one) — so both are recreated here, unchanged from that file.
create policy "profiles_select_team" on public.profiles for select using (
  auth.uid() = id
  or exists (
    select 1 from public.team_members tm1
    join public.team_members tm2 on tm1.team_id = tm2.team_id
    where tm1.user_id = auth.uid() and tm2.user_id = profiles.id
  )
);
create policy "profiles_insert" on public.profiles for insert with check (true);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);


-- ============================================================
-- 6. REALTIME — add the new tables
-- ============================================================
do $$ begin alter publication supabase_realtime add table public.teams;        exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.team_members; exception when duplicate_object then null; end $$;


-- ============================================================
-- 7. ONE-TIME SEED — group every *existing* account into one team
-- ============================================================
-- Everyone who already has an account becomes a member of a single
-- "TaskFlow" team; the profile below becomes its owner. All existing
-- tasks/submissions/queue items/projects/files are backfilled onto that
-- team. This does NOT affect future signups — see src/pages/Onboarding.js.

do $$
declare
  v_team_id  uuid;
  v_owner_id uuid;
begin
  select id into v_owner_id from public.profiles where email = 'judothin@gmail.com';
  if v_owner_id is null then
    raise exception 'No profile found with email judothin@gmail.com — update this email and re-run section 7.';
  end if;

  insert into public.teams (name, slug, invite_code, created_by)
  values ('TaskFlow', public.random_code(8), upper(public.random_code(8)), v_owner_id)
  returning id into v_team_id;

  insert into public.team_members (team_id, user_id, role)
  select v_team_id, id, case when id = v_owner_id then 'owner' else 'member' end
  from public.profiles;

  update public.tasks        set team_id = v_team_id where team_id is null;
  update public.submissions  set team_id = v_team_id where team_id is null;
  update public.queue        set team_id = v_team_id where team_id is null;
  update public.projects     set team_id = v_team_id where team_id is null;
  update public.file_entries set team_id = v_team_id where team_id is null;
end $$;

-- Now that every existing row has a team_id, make it mandatory going forward.
alter table public.tasks        alter column team_id set not null;
alter table public.submissions  alter column team_id set not null;
alter table public.queue        alter column team_id set not null;
alter table public.projects     alter column team_id set not null;
alter table public.file_entries alter column team_id set not null;


-- Done! ✅
-- Next: sign in as an existing user — you should land straight on the
-- dashboard (already a "TaskFlow" member) with all your existing data intact.
-- New signups will be sent to /onboarding to create or join a team.
