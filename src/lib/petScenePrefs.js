// ============================================================
// Which pets are visible in a given pet's environment/scene.
// Keyed per user, then per SCENE OWNER (a pet id). By default a pet's scene
// shows ONLY that pet — other pets are opt-in. We persist the VISIBLE set per
// owner; a missing entry means "owner only".
// ============================================================

const KEY = (uid) => `tf-pet-scene-${uid || 'anon'}`;
export const SCENE_CHANGED = 'pet-scene-changed';

function loadAll(uid) {
  try { return JSON.parse(localStorage.getItem(KEY(uid))) || {}; }
  catch { return {}; }
}

// The visible pet ids for a scene, defaulting to just the owner.
export function visibleIdsFor(uid, ownerId) {
  if (!ownerId) return [];
  const stored = loadAll(uid)[ownerId];
  return Array.isArray(stored) ? stored : [ownerId];
}

// Flip a pet's visibility in an owner's scene; returns the new visible array.
export function toggleVisible(uid, ownerId, petId) {
  if (!ownerId) return [];
  const all = loadAll(uid);
  const cur = new Set(Array.isArray(all[ownerId]) ? all[ownerId] : [ownerId]);
  if (cur.has(petId)) cur.delete(petId); else cur.add(petId);
  all[ownerId] = [...cur];
  try { localStorage.setItem(KEY(uid), JSON.stringify(all)); } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent(SCENE_CHANGED));
  return [...cur];
}
