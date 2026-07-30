-- ============================================================
-- Which special badges does Jayden Fagre deserve?
-- Run in: Supabase Dashboard > SQL Editor. Read-only (SELECT).
-- ============================================================
with me as (
  select id, (first_name || ' ' || last_name) as full_name
  from public.profiles
  where lower(first_name) = 'jayden' and lower(last_name) = 'fagre'
  limit 1
)
select
  -- 🔥 Firefighter — cleared 25+ critical tasks
  (select count(*) from public.tasks t, me
     where t.status = 'completed' and t.roi = 'critical'
       and t.completed_by ilike '%' || me.full_name || '%') >= 25            as firefighter,

  -- 💯 Century — 100+ completions in a single calendar month
  coalesce((select max(cnt) from (
      select count(*) as cnt
      from public.tasks t, me
      where t.status = 'completed' and t.date_completed is not null
        and t.completed_by ilike '%' || me.full_name || '%'
      group by date_trunc('month', t.date_completed)
   ) q), 0) >= 100                                                            as century,

  -- ⚡ Speed Runner — created a task and completed it within 10 min
  --    (excludes Quick Log, whose completion time equals its creation time)
  exists (select 1 from public.tasks t, me
      where t.created_by = me.id and t.status = 'completed'
        and t.date_completed is not null
        and t.date_completed > t.created_at
        and t.date_completed - t.created_at <= interval '10 minutes')         as speed_runner,

  -- 🧹 Clean Sweep — a team you're on currently has 0 open + 0 in-progress
  exists (
    select 1 from public.team_members tm
    where tm.user_id = (select id from me)
      and exists (select 1 from public.tasks t2 where t2.team_id = tm.team_id)
      and not exists (
        select 1 from public.tasks t3
        where t3.team_id = tm.team_id and t3.status in ('open','in_progress'))
  )                                                                           as clean_sweep,

  -- 🐾 Collector — owns every pet species (7 total)
  (select count(distinct p.species) from public.pets p
     where p.user_id = (select id from me)) >= 7                             as all_pets
;
