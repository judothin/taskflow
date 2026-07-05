// In-memory (not persisted to storage) last-known wander position per pet,
// keyed by pet id. PetSprite's own position state lives in a ref local to
// that component instance, so navigating away and back (which unmounts and
// remounts the page, and therefore the sprite) would otherwise reset it back
// to the center of its walk area every time. Reading/writing this small
// module-level store from PetSprite lets it pick up where it left off for
// as long as the tab stays open — it doesn't need to survive a real reload,
// just route navigation within the same session.
const positions = {};

export function getSavedPosition(petId) {
  return petId ? positions[petId] || null : null;
}

export function savePosition(petId, xPct, yPct) {
  if (!petId || !Number.isFinite(xPct) || !Number.isFinite(yPct)) return;
  positions[petId] = { xPct, yPct };
}
