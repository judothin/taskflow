-- ============================================================
-- TaskFlow — full pet colour customization
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ------------------------------------------------------------
-- `color` is { hex: '#rrggbb', strength: 0-100 } — an accurate
-- luminance-preserving recolour applied to the sprite via an SVG
-- filter. null = the pet's original colours.
-- (Supersedes the earlier hue-only `tint` column, now unused.)
-- ============================================================

alter table public.pets add column if not exists color jsonb;

-- Done! ✅
