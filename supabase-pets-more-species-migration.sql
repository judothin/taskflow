-- ============================================================
-- TaskFlow — Add 5 more pet species (minotaur, alchemist, dark-oracle,
-- fallen-angel, necromancer) alongside the original golem/wraith.
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-pets-migration.sql
-- ============================================================

-- Widen the species check constraint — it's a plain text column, so this
-- is the only schema change needed for new species (see the comment in
-- src/lib/petSpecies.js).
alter table public.pets drop constraint if exists pets_species_check;
alter table public.pets add constraint pets_species_check
  check (species in ('golem', 'wraith', 'minotaur', 'alchemist', 'dark-oracle', 'fallen-angel', 'necromancer'));

-- Nicer default pet name than initcap() would produce for hyphenated
-- species keys (e.g. initcap('dark-oracle') = 'Dark-Oracle').
create or replace function public.pet_species_label(p_species text)
returns text
language sql immutable
as $$
  select case p_species
    when 'golem' then 'Golem'
    when 'wraith' then 'Wraith'
    when 'minotaur' then 'Minotaur'
    when 'alchemist' then 'Alchemist'
    when 'dark-oracle' then 'Dark Oracle'
    when 'fallen-angel' then 'Fallen Angel'
    when 'necromancer' then 'Necromancer'
    else initcap(p_species)
  end;
$$;

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

  v_species := (array['golem','wraith','minotaur','alchemist','dark-oracle','fallen-angel','necromancer'])[floor(random()*7)::int + 1];
  select exists(select 1 from public.pets where user_id = auth.uid() and is_dead = false) into v_has_living;

  insert into public.pets (user_id, species, name, level, xp, health, hunger, water, style, is_active)
  values (auth.uid(), v_species, public.pet_species_label(v_species), 1, 0, 3, 100, 100, 1, not v_has_living)
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

  v_species := (array['golem','wraith','minotaur','alchemist','dark-oracle','fallen-angel','necromancer'])[floor(random()*7)::int + 1];

  insert into public.pets (user_id, species, name, level, xp, health, hunger, water, style, is_active)
  values (auth.uid(), v_species, public.pet_species_label(v_species), 1, 0, 3, 100, 100, 1, true)
  returning * into v_pet;

  return v_pet;
end;
$$;

-- Done! ✅ Existing pets (golem/wraith) are unaffected — this only widens
-- what's allowed and what claim_pet_unlock/sacrifice_for_new_pet can roll.
