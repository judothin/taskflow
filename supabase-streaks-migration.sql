-- ============================================================
-- TaskFlow — per-team activity streaks
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- A streak = consecutive days a user created OR completed a task, tracked
-- per team. Teams can pause weekends (so a missed weekend doesn't break the
-- streak), and owners/admins can set or pause an individual's streak.
-- ============================================================

-- Team-level: do weekends count toward streaks? (off = weekends are "excused")
alter table public.teams add column if not exists weekend_streaks boolean not null default true;

create table if not exists public.team_streaks (
  team_id          uuid references public.teams(id) on delete cascade not null,
  user_id          uuid references public.profiles(id) on delete cascade not null,
  current_streak   int not null default 0,
  best_streak      int not null default 0,
  last_active_date date,
  paused           boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.team_streaks enable row level security;

-- Any member of the team can read its members' streaks.
drop policy if exists team_streaks_select on public.team_streaks;
create policy team_streaks_select on public.team_streaks
  for select using (
    exists (select 1 from public.team_members m
            where m.team_id = team_streaks.team_id and m.user_id = auth.uid())
  );
-- All writes go through the security-definer RPCs below (no direct write policy).

-- ── Record activity for today, applying the streak rules ─────
-- p_today is the caller's LOCAL date ('YYYY-MM-DD') so day boundaries match
-- what the user sees, regardless of server timezone.
create or replace function public.bump_streak(p_team_id uuid, p_today date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_weekend boolean;
  r public.team_streaks%rowtype;
  v_missed int;
  v_new int;
begin
  if v_uid is null then return; end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = v_uid) then
    return;
  end if;

  select coalesce(weekend_streaks, true) into v_weekend from public.teams where id = p_team_id;

  select * into r from public.team_streaks where team_id = p_team_id and user_id = v_uid;

  if not found then
    insert into public.team_streaks (team_id, user_id, current_streak, best_streak, last_active_date)
    values (p_team_id, v_uid, 1, 1, p_today);
    return;
  end if;

  if r.last_active_date = p_today then
    return; -- already counted today
  end if;

  if r.paused then
    -- Paused: never resets, but activity still grows it.
    v_new := r.current_streak + 1;
  else
    -- Count "required" days missed strictly between last active and today.
    -- When weekends are excused, Sat/Sun (dow 6/0) don't count as missed.
    select count(*) into v_missed
    from generate_series(r.last_active_date + 1, p_today - 1, interval '1 day') d
    where v_weekend or extract(dow from d) not in (0, 6);

    if v_missed > 0 then
      v_new := 1;             -- a required day was skipped → streak broke
    else
      v_new := r.current_streak + 1;
    end if;
  end if;

  update public.team_streaks
     set current_streak = v_new,
         best_streak = greatest(best_streak, v_new),
         last_active_date = p_today,
         updated_at = now()
   where team_id = p_team_id and user_id = v_uid;
end $$;

-- ── Owner: toggle whether weekends count for the whole team ──
create or replace function public.set_team_weekend_streaks(p_team_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.team_members
                 where team_id = p_team_id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the team owner can change this setting';
  end if;
  update public.teams set weekend_streaks = p_enabled where id = p_team_id;
end $$;

-- ── Owner/admin: set a member's streak count ────────────────
create or replace function public.admin_set_streak(p_team_id uuid, p_user_id uuid, p_streak int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.team_members
                 where team_id = p_team_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'Only owners/admins can set streaks';
  end if;
  insert into public.team_streaks (team_id, user_id, current_streak, best_streak, last_active_date)
  values (p_team_id, p_user_id, greatest(0, p_streak), greatest(0, p_streak), current_date)
  on conflict (team_id, user_id) do update
    set current_streak = greatest(0, p_streak),
        best_streak = greatest(public.team_streaks.best_streak, greatest(0, p_streak)),
        updated_at = now();
end $$;

-- ── Owner/admin: pause / resume a member's streak ───────────
create or replace function public.admin_set_streak_paused(p_team_id uuid, p_user_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.team_members
                 where team_id = p_team_id and user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'Only owners/admins can pause streaks';
  end if;
  insert into public.team_streaks (team_id, user_id, paused)
  values (p_team_id, p_user_id, p_paused)
  on conflict (team_id, user_id) do update
    set paused = p_paused, updated_at = now();
end $$;

-- Done! ✅
