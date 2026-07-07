-- ============================================================
-- TaskFlow — Pet size slider
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- Run this AFTER supabase-pets-migration.sql
-- ============================================================

-- `size_scale` is a per-pet multiplier applied to the pet's size *relative to
-- whatever environment it's rendered in*. The sprite's on-screen height is a
-- fraction of its stage's height (so it's big in the large Pets-page scene and
-- proportionally smaller in the dashboard widget, shrinking/growing with the
-- widget); size_scale then scales that baseline up or down. 1 = default size.
-- The slider on the Pets page writes this, and both the Pets page and the
-- dashboard widget read it, so one control governs both views.
alter table public.pets add column if not exists size_scale numeric not null default 1;

-- Done! ✅ No changes needed to claim_pet_unlock / sacrifice_for_new_pet —
-- both omit this column on insert, so new pets just take the default (1).
