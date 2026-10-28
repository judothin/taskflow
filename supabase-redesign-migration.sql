-- ============================================================
-- TaskFlow — redesign migration (run once, at the end)
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- Requires the earlier migrations (teams, review, context, golive).
-- Every section is safe to re-run.
--
-- What it does
--   1. tasks.title                     (tasks are now title + description)
--   2. drops Projects                  (projects, project_* tables, tasks.project_id)
--   3. drops streaks                   (team_streaks, streak RPCs, teams.weekend_streaks)
--   4. clears saved dashboard / nav layouts
--   5. review_posts.files + review_create(p_files), and drops the old
--                                       Go Live tables once they are empty
--   6. context_entries.tags            (custom tags like "Dev only")
--   7. submissions.title
--
-- Sections 2 and 3 DELETE data for removed features. Take a
-- backup first if you might want it back.
-- ============================================================

-- ── 1. Tasks get a real title ────────────────────────────────────────
-- The app shows a task as a title + description. Older tasks keep working
-- without one (the app uses the first line of the description), so this is
-- purely additive.
alter table public.tasks add column if not exists title text;

-- ── 2. Projects are gone ─────────────────────────────────────────────
-- Removes the Projects feature's tables and the link from tasks. Tasks
-- themselves are untouched.
drop table if exists public.project_comment_reads cascade;
drop table if exists public.project_comments cascade;
drop table if exists public.project_reads cascade;
alter table public.tasks drop column if exists project_id;
drop table if exists public.projects cascade;

-- ── 3. Streaks are gone ──────────────────────────────────────────────
-- Levels and XP stay (user_levels). The per-team streak table, its RPCs and
-- the weekend-streak team setting are removed.
drop function if exists public.bump_streak(uuid, date);
drop function if exists public.set_team_weekend_streaks(uuid, boolean);
drop function if exists public.admin_set_streak(uuid, uuid, int);
drop function if exists public.admin_set_streak_paused(uuid, uuid, boolean);
drop table if exists public.team_streaks cascade;
alter table public.teams drop column if exists weekend_streaks;

-- ── 4. Custom dashboards and nav layouts are gone ────────────────────
-- The dashboard is now a fixed layout and the rail is fixed, so the saved
-- layouts are cleared (the columns stay, empty, in case anything old reads them).
update public.user_preferences set dashboard_layout = null where dashboard_layout is not null;
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'nav_layout') then
    execute 'update public.user_preferences set nav_layout = null where nav_layout is not null';
  end if;
end $$;


-- ── 5. Go Live → Review ─────────────────────────────────────────────
-- ============================================================
-- TaskFlow — Review ⇄ Go Live merge
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run AFTER supabase-review-migration.sql (and, if you have it,
-- supabase-golive-migration.sql). Safe to re-run.
--
-- Go Live is folded into Ready for review:
--   * review posts get a free-text `files` deploy note ("Files to push"),
--   * review_create() takes an optional p_files,
--   * golive_items / golive_hidden are left untouched for now (their own
--     page lists them until they've been cleared).
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────

-- One file per line; anything after " — " is a note about that file.
alter table public.review_posts add column if not exists files text not null default '';

-- Marker for rows carried over from Go Live: the old golive_items.id. Makes
-- the copy idempotent (a re-run skips rows already moved) and lets the app
-- say "Carried over from Go Live" instead of naming a reviewer that never
-- existed. No FK — golive_items is dropped below.
alter table public.review_posts add column if not exists golive_id uuid;
create unique index if not exists review_posts_golive_id_key
  on public.review_posts (golive_id) where golive_id is not null;


-- ── 2. Guard trigger ────────────────────────────────────────
-- Same rules as before. `files` is ordinary content: the author or a team
-- admin may edit it with a plain UPDATE (RLS policy review_posts_update_owner
-- already limits UPDATE to can_manage_review), and editing it counts as an
-- edit for updated_at. golive_id is fixed once set.
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
       new.status       is distinct from old.status
    or new.round        is distinct from old.round
    or new.decided_by   is distinct from old.decided_by
    or new.decided_at   is distinct from old.decided_at
    or new.went_live_at is distinct from old.went_live_at
    or new.went_live_by is distinct from old.went_live_by
  ) then
    raise exception 'Only a reviewer can change a review''s status';
  end if;

  -- The shared order belongs to owners/admins (review_reorder), not authors.
  if coalesce(current_setting('taskflow.review_rpc', true), '') <> 'on'
     and new.position is distinct from old.position then
    raise exception 'Only a team owner or admin can reorder reviews';
  end if;

  new.team_id    := old.team_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.golive_id  := old.golive_id;
  -- Moving a post isn't editing it: a reorder alone leaves "updated" alone.
  if (new.title, new.url, new.description, new.screenshots, new.files, new.status, new.round)
     is not distinct from (old.title, old.url, old.description, old.screenshots, old.files, old.status, old.round)
     and new.position is distinct from old.position then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists review_posts_guard on public.review_posts;
create trigger review_posts_guard
  before insert or update on public.review_posts
  for each row execute function public.review_posts_guard();


-- ── 3. review_create with files ─────────────────────────────
-- The old 6-argument version is dropped first: keeping both would make a
-- call with the six original named args ambiguous. p_files defaults to '',
-- so existing callers (six args) keep working.
drop function if exists public.review_create(uuid, text, text, text, text[], uuid[]);

create or replace function public.review_create(
  p_team_id uuid, p_title text, p_url text, p_description text,
  p_screenshots text[], p_reviewers uuid[], p_files text default ''
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
  -- New posts go to the top of the team's order.
  insert into public.review_posts (team_id, title, url, description, screenshots, files, created_by, position)
  values (p_team_id, trim(p_title), coalesce(trim(p_url), ''), coalesce(p_description, ''),
          coalesce(p_screenshots, '{}'), coalesce(trim(p_files), ''), auth.uid(),
          coalesce((select min(position) from public.review_posts where team_id = p_team_id), 1) - 1)
  returning id into v_id;

  insert into public.review_reviewers (post_id, user_id, team_id)
  select v_id, r, p_team_id from unnest(v_reviewers) r;

  insert into public.review_events (post_id, team_id, round, kind, actor)
  values (v_id, p_team_id, 1, 'submitted', auth.uid());

  perform set_config('taskflow.review_rpc', '', true);
  return v_id;
end;
$$;


-- ── 4./5. Drop the old Go Live tables ───────────────────────
-- Go Live items are NOT copied into Review. The Go Live page is gone, so its
-- tables are dropped — but only once they're empty, so nothing still in
-- there is lost. If rows remain, this leaves the tables alone and says so.
do $$
begin
  if to_regclass('public.golive_items') is null then
    return;
  end if;
  if exists (select 1 from public.golive_items) then
    raise notice 'golive_items still has rows — leaving the Go Live tables in place';
    return;
  end if;
  drop table if exists public.golive_hidden;
  drop table if exists public.golive_items;
end $$;

notify pgrst, 'reload schema';


-- ── 6. Context tags ─────────────────────────────────────────────────
-- ============================================================
-- TaskFlow — Context tags
-- Run in: Supabase Dashboard > SQL Editor > New Query
-- Requires supabase-context-migration.sql (context_entries) first.
-- Safe to re-run.
-- ============================================================

-- Custom, team-wide tags on context entries ("Dev only", "Live", "Plugin").
-- Kept deliberately simple: tags live on the entry itself as
--   [{ "name": "Dev only", "color": "yellow" }, …]
-- and the team's tag palette is just the distinct tags across its entries.
-- color is one of: yellow, blue, green, red, purple, pink, gray.
alter table public.context_entries
  add column if not exists tags jsonb not null default '[]'::jsonb;

-- Rows written before the column existed (or by an older client) could only
-- ever be the default, but make sure nothing non-array slips in.
update public.context_entries
  set tags = '[]'::jsonb
  where tags is null or jsonb_typeof(tags) <> 'array';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'context_entries_tags_is_array'
      and conrelid = 'public.context_entries'::regclass
  ) then
    alter table public.context_entries
      add constraint context_entries_tags_is_array check (jsonb_typeof(tags) = 'array');
  end if;
end $$;

-- Filtering by tag happens client-side today; this keeps a server-side
-- "entries tagged X" query (tags @> '[{"name":"Live"}]') cheap if one is added.
create index if not exists context_entries_tags_idx
  on public.context_entries using gin (tags jsonb_path_ops);

-- PostgREST caches the schema; without this the new column stays invisible
-- to the API and saves fail with "could not find the 'tags' column".
notify pgrst, 'reload schema';


-- ── 7. Submission titles ────────────────────────────────────────────
-- Settings / guest portal / submissions redesign
-- Safe to re-run.

-- Guest portal now asks "What needs fixing?" as a short title, stored on the
-- submission and copied to tasks.title when it's approved. (The app retries
-- without this column if it's missing, folding the title into feedback.)
alter table public.submissions add column if not exists title text;

-- Make PostgREST pick up the new column straight away.
notify pgrst, 'reload schema';


notify pgrst, 'reload schema';
