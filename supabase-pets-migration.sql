-- ============================================================
-- TaskFlow — Pet gamification system
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- ============================================================
-- 1. TABLES (per-user, not team-scoped — leveling is personal)
-- ============================================================

create table if not exists public.user_levels (
  user_id             uuid references public.profiles(id) on delete cascade primary key,
  level               int not null default 1,
  xp                  int not null default 0,
  pending_pet_unlocks int not null default 0,
  updated_at          timestamptz default now()
);

create table if not exists public.pets (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  species      text not null check (species in ('golem','wraith')),
  name         text not null,
  level        int not null default 1,
  xp           int not null default 0,
  health       numeric not null default 3,
  hunger       numeric not null default 100,
  water        numeric not null default 100,
  style        int not null default 1,
  is_active    boolean not null default false,
  is_dead      boolean not null default false,
  last_tick_at timestamptz not null default now(),
  created_at   timestamptz default now()
);

-- Only one active pet per user at a time.
create unique index if not exists pets_one_active_per_user on public.pets(user_id) where is_active;


-- ============================================================
-- 2. RPCs (security definer so the random pick + counter update
--    stay atomic — same pattern as create_team / join_team_by_code)
-- ============================================================

create or replace function public.claim_pet_unlock()
returns public.pets
language plpgsql security definer set search_path = public
as $$
declare
  v_pending    int;
  v_species    text;
  v_has_living boolean;
  v_pet        public.pets;
begin
  select pending_pet_unlocks into v_pending from public.user_levels where user_id = auth.uid() for update;
  if v_pending is null or v_pending <= 0 then
    raise exception 'No pending pet unlocks';
  end if;

  v_species := (array['golem','wraith'])[floor(random()*2)::int + 1];
  select exists(select 1 from public.pets where user_id = auth.uid() and is_dead = false) into v_has_living;

  insert into public.pets (user_id, species, name, level, xp, health, hunger, water, style, is_active)
  values (auth.uid(), v_species, initcap(v_species), 1, 0, 3, 100, 100, 1, not v_has_living)
  returning * into v_pet;

  update public.user_levels set pending_pet_unlocks = pending_pet_unlocks - 1, updated_at = now()
  where user_id = auth.uid();

  return v_pet;
end;
$$;

create or replace function public.sacrifice_for_new_pet()
returns public.pets
language plpgsql security definer set search_path = public
as $$
declare
  v_has_living boolean;
  v_species    text;
  v_pet        public.pets;
begin
  select exists(select 1 from public.pets where user_id = auth.uid() and is_dead = false) into v_has_living;
  if v_has_living then
    raise exception 'You still have a living pet';
  end if;

  update public.user_levels set level = 1, xp = 0, pending_pet_unlocks = 0, updated_at = now()
  where user_id = auth.uid();

  v_species := (array['golem','wraith'])[floor(random()*2)::int + 1];

  insert into public.pets (user_id, species, name, level, xp, health, hunger, water, style, is_active)
  values (auth.uid(), v_species, initcap(v_species), 1, 0, 3, 100, 100, 1, true)
  returning * into v_pet;

  return v_pet;
end;
$$;


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.user_levels enable row level security;
alter table public.pets        enable row level security;

create policy "user_levels_own" on public.user_levels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "pets_own" on public.pets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================
-- 4. ONE-TIME SEED — every existing profile gets the same
--    first-pet-spin treatment new signups get.
-- ============================================================

insert into public.user_levels (user_id, level, xp, pending_pet_unlocks)
select id, 1, 0, 1 from public.profiles
where id not in (select user_id from public.user_levels)
on conflict (user_id) do nothing;


-- Done! ✅
-- Next: sign in — you should be routed to /pet-reveal to spin for your
-- first pet before reaching the dashboard.
