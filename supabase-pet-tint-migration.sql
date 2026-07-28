-- ============================================================
-- TaskFlow — pet colour customization
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- `tint` is a hue-rotation in degrees (0–360) applied to the pet
-- sprite as a CSS filter. 0 = the sprite's original colours.
-- ============================================================

alter table public.pets add column if not exists tint int not null default 0;

-- Done! ✅
