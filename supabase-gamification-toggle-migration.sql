-- ============================================================
-- TaskFlow — Gamification (pets/XP) opt-in/opt-out toggles
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-pets-migration.sql and
-- supabase-pets-adjustments-migration.sql
-- ============================================================

-- Per-team admin toggle. When false, the whole pet/XP system is hidden
-- for anyone currently viewing that team (their own XP/pets keep
-- accruing in the background — see PetContext.js — so switching to a
-- team with it enabled reveals whatever they earned in the meantime).
alter table public.teams add column if not exists gamification_enabled boolean not null default true;

-- Per-user personal toggle. Unlike the team one, turning this off
-- actually PAUSES the user's own XP/pet accrual (no background catch-up).
-- `gamification_choice_made` tracks whether the user has ever been asked
-- (new signups are asked immediately; existing users who already have a
-- pet are treated as having implicitly chosen already).
alter table public.user_levels add column if not exists gamification_enabled boolean not null default true;
alter table public.user_levels add column if not exists gamification_choice_made boolean not null default true;

-- Existing users who never actually got a pet yet (still mid-onboarding
-- in spirit) haven't really made this choice — let them choose too,
-- same as a brand new signup would.
update public.user_levels ul
set gamification_choice_made = false
where not exists (select 1 from public.pets p where p.user_id = ul.user_id);

-- Admin-only team setting, same pattern as rename_team/regenerate_invite_code
-- in supabase-teams-migration.sql — no direct UPDATE RLS policy on
-- `teams`, this security-definer RPC does its own role check instead.
create or replace function public.set_team_gamification(p_team_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_team_admin(p_team_id) then
    raise exception 'Only team owners/admins can change this setting';
  end if;
  update public.teams set gamification_enabled = p_enabled where id = p_team_id;
end;
$$;

-- Done! ✅ user_levels already has an owner-only RLS policy from
-- supabase-pets-migration.sql (using (auth.uid() = user_id)), so users can
-- update their own gamification_enabled/gamification_choice_made directly —
-- no new RPC needed for the personal toggle.
