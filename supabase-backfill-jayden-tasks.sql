-- ============================================================
-- TaskFlow — backfill YOUR task-achievement count
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- completed_by is free-text (a comma-separated list of names), so we count
-- every completed task whose completers include "jayden" and set that as
-- your tasks_completed total. Safe to re-run (it sets, not increments).
-- ============================================================

update public.user_levels ul
set tasks_completed = (
  select count(*)
  from public.tasks t
  where t.status = 'completed'
    and t.completed_by ilike '%jayden%'
)
where ul.user_id = (
  select id from auth.users where lower(email) = 'marketing@palmerindustries.com'
);

-- Check the result:
select tasks_completed
from public.user_levels
where user_id = (select id from auth.users where lower(email) = 'marketing@palmerindustries.com');

-- ------------------------------------------------------------
-- ALTERNATIVE: if the email above isn't your account, match by profile
-- name instead (uncomment and run this instead of the update above):
--
-- update public.user_levels ul
-- set tasks_completed = (
--   select count(*) from public.tasks t
--   where t.status = 'completed' and t.completed_by ilike '%jayden%'
-- )
-- where ul.user_id = (
--   select id from public.profiles where first_name ilike 'jayden' limit 1
-- );
-- ------------------------------------------------------------

-- Done! ✅  Reload TaskFlow and your Tasks badges will unlock.
