-- ============================================================
-- TaskFlow — Pet adjustments (environments, walking area, idle animation)
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-pets-migration.sql
-- ============================================================

-- `environment` is either a built-in key ('default' | 'nature' | 'night' |
-- 'planet') or a full URL to a custom-uploaded image. `walk_area` is
-- {x,y,w,h} as 0–1 fractions of the stage, null until the user sets one
-- (the app falls back to a sensible default). `idle_animation` is which
-- animation plays while standing still, in both the environment and the
-- sidebar nav slot.
alter table public.pets add column if not exists environment     text not null default 'default';
alter table public.pets add column if not exists walk_area       jsonb;
alter table public.pets add column if not exists idle_animation  text not null default 'idle';

-- A user's personal library of uploaded environment images, reusable across
-- all their pets — same idea as user_backgrounds for the app-wide theme.
create table if not exists public.pet_environments (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  url        text not null,
  created_at timestamptz default now()
);

alter table public.pet_environments enable row level security;
create policy "pet_environments_own" on public.pet_environments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Done! ✅ No changes needed to claim_pet_unlock / sacrifice_for_new_pet —
-- both omit these columns on insert, so new pets just take the defaults.
