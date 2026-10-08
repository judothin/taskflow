-- ============================================================
-- TaskFlow — Ready for Review Migration
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-teams-migration.sql (it uses the
-- is_team_member / is_team_admin helpers created there).
-- Safe to re-run.
-- ============================================================

-- Work that's ready for someone to look at. One post per thing to review:
-- a link to it, what to look at, optional screenshots, and the people
-- allowed to sign it off.
--
-- Any ONE assigned reviewer decides: "approved" (reviewed, ready for live)
-- or "needs_work" (with a required note). The author fixes it and
-- resubmits, which starts the next round. Every submission, verdict and
-- resubmission is kept in review_events, so the whole back-and-forth stays
-- readable.
--
-- Status only changes through the RPCs at the bottom (security definer,
-- each checking who's asking). A trigger stops plain UPDATEs touching the
-- status columns, so the "only reviewers can decide" rule holds no matter
-- what the browser sends.


-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.review_posts (
  id           uuid default gen_random_uuid() primary key,
  team_id      uuid references public.teams(id) on delete cascade not null,
  title        text not null,
  url          text not null default '',
  description  text not null default '',
  screenshots  text[] not null default '{}',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'needs_work')),
  round        int  not null default 1,
  decided_by   uuid references public.profiles(id) on delete set null,
  decided_at   timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists review_posts_team_idx
  on public.review_posts (team_id, status, updated_at desc);

-- Who may sign a post off. team_id is copied from the post so realtime can
-- filter by team and RLS needn't join.
create table if not exists public.review_reviewers (
  post_id  uuid references public.review_posts(id) on delete cascade not null,
  user_id  uuid references public.profiles(id) on delete cascade not null,
  team_id  uuid references public.teams(id) on delete cascade not null,
  primary key (post_id, user_id)
);

create index if not exists review_reviewers_user_idx
  on public.review_reviewers (team_id, user_id);

-- The history: one row per submission, verdict, resubmission or undo.
create table if not exists public.review_events (
  id          uuid default gen_random_uuid() primary key,
  post_id     uuid references public.review_posts(id) on delete cascade not null,
  team_id     uuid references public.teams(id) on delete cascade not null,
  round       int  not null,
  kind        text not null check (kind in ('submitted', 'approved', 'needs_work', 'resubmitted', 'reopened')),
  actor       uuid references public.profiles(id) on delete set null,
  note        text not null default '',
  created_at  timestamptz default now()
);

create index if not exists review_events_post_idx
  on public.review_events (post_id, created_at);
create index if not exists review_events_team_idx
  on public.review_events (team_id, created_at desc);

create table if not exists public.review_comments (
  id          uuid default gen_random_uuid() primary key,
  post_id     uuid references public.review_posts(id) on delete cascade not null,
  team_id     uuid references public.teams(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete set null,
  content     text not null,
  created_at  timestamptz default now(),
  edited_at   timestamptz
);

create index if not exists review_comments_post_idx
  on public.review_comments (post_id, created_at);
create index if not exists review_comments_team_idx
  on public.review_comments (team_id, created_at desc);

-- Team-wide reviewer list that pre-fills every new post.
create table if not exists public.review_settings (
  team_id            uuid references public.teams(id) on delete cascade primary key,
  default_reviewers  uuid[] not null default '{}',
  updated_at         timestamptz default now()
);


-- ============================================================
-- 2. HELPERS
-- ============================================================

create or replace function public.is_review_reviewer(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.review_reviewers
    where post_id = p_post_id and user_id = auth.uid()
  );
$$;

-- The author, or a team owner/admin.
create or replace function public.can_manage_review(p_post_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.review_posts p
    where p.id = p_post_id
      and (p.created_by = auth.uid() or public.is_team_admin(p.team_id))
  );
$$;

-- Keeps the review columns out of reach of plain UPDATEs (only the RPCs
-- below, which set taskflow.review_rpc for their own transaction, may change
-- them), and keeps team/author fixed.
create or replace function public.review_posts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('taskflow.review_rpc', true), '') <> 'on' then
      raise exception 'Create review posts with review_create()';
    end if;
    return new;
  end if;

  if coalesce(current_setting('taskflow.review_rpc', true), '') <> 'on' and (
       new.status     is distinct from old.status
    or new.round      is distinct from old.round
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
  ) then
    raise exception 'Only a reviewer can change a review''s status';
  end if;

  new.team_id    := old.team_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists review_posts_guard on public.review_posts;
create trigger review_posts_guard
  before insert or update on public.review_posts
  for each row execute function public.review_posts_guard();


-- ============================================================
-- 3. RPCs
-- ============================================================

-- Keep only ids that are members of the team, de-duplicated.
create or replace function public.review_clean_reviewers(p_team_id uuid, p_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from public.team_members m
  where m.team_id = p_team_id and m.user_id = any(coalesce(p_ids, '{}'));
$$;

create or replace function public.review_create(
  p_team_id uuid, p_title text, p_url text, p_description text,
  p_screenshots text[], p_reviewers uuid[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_reviewers uuid[];
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'Not a member of this team';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'A title is required';
  end if;
  v_reviewers := public.review_clean_reviewers(p_team_id, p_reviewers);
  if coalesce(array_length(v_reviewers, 1), 0) = 0 then
    raise exception 'Pick at least one reviewer';
  end if;

  perform set_config('taskflow.review_rpc', 'on', true);
  insert into public.review_posts (team_id, title, url, description, screenshots, created_by)
  values (p_team_id, trim(p_title), coalesce(trim(p_url), ''), coalesce(p_description, ''),
          coalesce(p_screenshots, '{}'), auth.uid())
  returning id into v_id;

  insert into public.review_reviewers (post_id, user_id, team_id)
  select v_id, r, p_team_id from unnest(v_reviewers) r;

  insert into public.review_events (post_id, team_id, round, kind, actor)
  values (v_id, p_team_id, 1, 'submitted', auth.uid());

  perform set_config('taskflow.review_rpc', '', true);
  return v_id;
end;
$$;

-- Replace a post's reviewer list (author or admin).
create or replace function public.review_set_reviewers(p_post_id uuid, p_reviewers uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid;
  v_reviewers uuid[];
begin
  if not public.can_manage_review(p_post_id) then
    raise exception 'Only the author or a team admin can change reviewers';
  end if;
  select team_id into v_team from public.review_posts where id = p_post_id;
  v_reviewers := public.review_clean_reviewers(v_team, p_reviewers);
  if coalesce(array_length(v_reviewers, 1), 0) = 0 then
    raise exception 'A post needs at least one reviewer';
  end if;
  delete from public.review_reviewers where post_id = p_post_id and not (user_id = any(v_reviewers));
  insert into public.review_reviewers (post_id, user_id, team_id)
  select p_post_id, r, v_team from unnest(v_reviewers) r
  on conflict do nothing;
  -- Touch the post: realtime doesn't deliver filtered DELETEs, so this is how
  -- other open tabs hear that a reviewer was removed.
  update public.review_posts set updated_at = now() where id = p_post_id;
end;
$$;

-- A reviewer's verdict. Any one reviewer decides; "needs work" must say why.
create or replace function public.review_decide(p_post_id uuid, p_verdict text, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_post public.review_posts;
begin
  if p_verdict not in ('approved', 'needs_work') then
    raise exception 'Unknown verdict';
  end if;
  if not public.is_review_reviewer(p_post_id) then
    raise exception 'Only an assigned reviewer can decide this';
  end if;
  select * into v_post from public.review_posts where id = p_post_id for update;
  if v_post.status <> 'pending' then
    raise exception 'This has already been decided';
  end if;
  if p_verdict = 'needs_work' and coalesce(trim(p_note), '') = '' then
    raise exception 'Say what needs work';
  end if;

  perform set_config('taskflow.review_rpc', 'on', true);
  update public.review_posts
  set status = p_verdict, decided_by = auth.uid(), decided_at = now()
  where id = p_post_id;

  insert into public.review_events (post_id, team_id, round, kind, actor, note)
  values (p_post_id, v_post.team_id, v_post.round, p_verdict, auth.uid(), coalesce(trim(p_note), ''));
  perform set_config('taskflow.review_rpc', '', true);
end;
$$;

-- Undo a verdict (a mis-click): back to pending in the same round. Any
-- reviewer, or the author/admin.
create or replace function public.review_reopen(p_post_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_post public.review_posts;
begin
  if not (public.is_review_reviewer(p_post_id) or public.can_manage_review(p_post_id)) then
    raise exception 'Not allowed';
  end if;
  select * into v_post from public.review_posts where id = p_post_id for update;
  if v_post.status = 'pending' then return; end if;

  perform set_config('taskflow.review_rpc', 'on', true);
  update public.review_posts
  set status = 'pending', decided_by = null, decided_at = null
  where id = p_post_id;
  insert into public.review_events (post_id, team_id, round, kind, actor)
  values (p_post_id, v_post.team_id, v_post.round, 'reopened', auth.uid());
  perform set_config('taskflow.review_rpc', '', true);
end;
$$;

-- After "needs work": the author (or an admin) sends it back for the next
-- round, optionally saying what changed.
create or replace function public.review_resubmit(p_post_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_post public.review_posts;
begin
  if not public.can_manage_review(p_post_id) then
    raise exception 'Only the author or a team admin can resubmit';
  end if;
  select * into v_post from public.review_posts where id = p_post_id for update;
  if v_post.status <> 'needs_work' then
    raise exception 'Only posts marked "needs work" can be resubmitted';
  end if;

  perform set_config('taskflow.review_rpc', 'on', true);
  update public.review_posts
  set status = 'pending', round = v_post.round + 1, decided_by = null, decided_at = null
  where id = p_post_id;
  insert into public.review_events (post_id, team_id, round, kind, actor, note)
  values (p_post_id, v_post.team_id, v_post.round + 1, 'resubmitted', auth.uid(), coalesce(trim(p_note), ''));
  perform set_config('taskflow.review_rpc', '', true);
end;
$$;


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table public.review_posts     enable row level security;
alter table public.review_reviewers enable row level security;
alter table public.review_events    enable row level security;
alter table public.review_comments  enable row level security;
alter table public.review_settings  enable row level security;

-- Name-agnostic sweep so a re-run can't leave a stale policy behind.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('review_posts', 'review_reviewers', 'review_events', 'review_comments', 'review_settings')
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- Posts: the team reads; creation goes through review_create(); the author
-- or an admin edits the content (not the status — see the trigger) and
-- deletes.
create policy "review_posts_select_team" on public.review_posts
  for select using (public.is_team_member(team_id));
create policy "review_posts_update_owner" on public.review_posts
  for update using (public.can_manage_review(id))
  with check (public.is_team_member(team_id));
create policy "review_posts_delete_owner" on public.review_posts
  for delete using (public.can_manage_review(id));

-- Reviewers and events: read-only to the team; written by the RPCs.
create policy "review_reviewers_select_team" on public.review_reviewers
  for select using (public.is_team_member(team_id));
create policy "review_events_select_team" on public.review_events
  for select using (public.is_team_member(team_id));

-- Comments: any teammate comments; you edit and delete your own.
create policy "review_comments_select_team" on public.review_comments
  for select using (public.is_team_member(team_id));
create policy "review_comments_insert_team" on public.review_comments
  for insert with check (
    user_id = auth.uid()
    and public.is_team_member(team_id)
    and exists (select 1 from public.review_posts p where p.id = post_id and p.team_id = review_comments.team_id)
  );
create policy "review_comments_update_own" on public.review_comments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "review_comments_delete_own" on public.review_comments
  for delete using (user_id = auth.uid());

-- Default reviewers: the team reads; owners/admins set them.
create policy "review_settings_select_team" on public.review_settings
  for select using (public.is_team_member(team_id));
create policy "review_settings_insert_admin" on public.review_settings
  for insert with check (public.is_team_admin(team_id));
create policy "review_settings_update_admin" on public.review_settings
  for update using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));


-- ============================================================
-- 5. REALTIME
-- ============================================================

do $$ begin alter publication supabase_realtime add table public.review_posts;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.review_reviewers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.review_events;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.review_comments;  exception when duplicate_object then null; end $$;

-- Make the new tables and functions visible to the API straight away.
notify pgrst, 'reload schema';
