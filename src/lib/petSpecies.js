// ============================================================
// Pet species registry — asset paths + per-species animation sets.
// Adding a new species later is just a new entry here plus copying its
// PNG sequence frames into public/pets/<key>/<style>/<animation-slug>/<n>.webp
// (species is a plain `text` check-constraint column in the DB, not an enum,
// so no migration is needed beyond widening that check).
//
// Frames are served as .webp, resized down from the 720x480 originals —
// the sprite is never displayed larger than ~140px, so the source assets
// were needlessly huge for what's actually rendered on screen.
// ============================================================

export const SPECIES = {
  golem: {
    label: 'Golem',
    frameCounts: {
      idle: 12, 'idle-blink': 12, walking: 18, taunt: 18,
      attacking: 12, hurt: 12, dying: 15, 'jump-start': 6, 'jump-loop': 6,
    },
  },
  wraith: {
    label: 'Wraith',
    frameCounts: {
      idle: 12, 'idle-blink': 12, walking: 12, taunt: 18,
      attacking: 12, hurt: 12, dying: 15, 'casting-spells': 18,
    },
  },
  minotaur: {
    label: 'Minotaur',
    frameCounts: {
      idle: 12, 'idle-blink': 12, walking: 18, taunt: 18,
      attacking: 12, hurt: 12, dying: 15, 'jump-start': 6, 'jump-loop': 6,
    },
  },
  alchemist: {
    label: 'Alchemist',
    frameCounts: {
      idle: 18, walking: 24, running: 12, sliding: 6,
      'jump-start': 6, 'jump-loop': 6, 'falling-down': 6,
      slashing: 12, 'slashing-in-the-air': 12, 'run-slashing': 12,
      throwing: 12, 'throwing-in-the-air': 12, 'run-throwing': 12,
      kicking: 12, hurt: 12, dying: 15,
    },
  },
  'dark-oracle': {
    label: 'Dark Oracle',
    frameCounts: {
      idle: 18, 'idle-blinking': 18, walking: 24, running: 12, sliding: 6,
      'jump-start': 6, 'jump-loop': 6, 'falling-down': 6,
      slashing: 12, 'slashing-in-the-air': 12, 'run-slashing': 12,
      throwing: 12, 'throwing-in-the-air': 12, 'run-throwing': 12,
      kicking: 12, hurt: 12, dying: 15,
    },
  },
  'fallen-angel': {
    label: 'Fallen Angel',
    frameCounts: {
      idle: 18, 'idle-blinking': 18, walking: 24, running: 12, sliding: 6,
      'jump-start': 6, 'jump-loop': 6, 'falling-down': 6,
      slashing: 12, 'slashing-in-the-air': 12, 'run-slashing': 12,
      throwing: 12, 'throwing-in-the-air': 12, 'run-throwing': 12,
      kicking: 12, hurt: 12, dying: 15,
    },
  },
  necromancer: {
    label: 'Necromancer',
    frameCounts: {
      idle: 18, 'idle-blinking': 18, walking: 24, running: 12, sliding: 6,
      'jump-start': 6, 'jump-loop': 6, 'falling-down': 6,
      slashing: 12, 'slashing-in-the-air': 12, 'run-slashing': 12,
      throwing: 12, 'throwing-in-the-air': 12, 'run-throwing': 12,
      kicking: 12, hurt: 12, dying: 15,
    },
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES);

export const ANIMATION_LABELS = {
  idle: 'Idle',
  'idle-blink': 'Idle Blink',
  'idle-blinking': 'Idle Blink',
  walking: 'Walk',
  running: 'Run',
  sliding: 'Slide',
  taunt: 'Taunt',
  attacking: 'Attack',
  hurt: 'Hurt',
  dying: 'Faint',
  'jump-start': 'Jump',
  'jump-loop': 'Jump (loop)',
  'falling-down': 'Fall',
  'casting-spells': 'Cast Spell',
  slashing: 'Slash',
  'slashing-in-the-air': 'Air Slash',
  'run-slashing': 'Run + Slash',
  throwing: 'Throw',
  'throwing-in-the-air': 'Air Throw',
  'run-throwing': 'Run + Throw',
  kicking: 'Kick',
};

// Animations excluded from the manual "make him do an action" picker even
// though they're used automatically (Hurt on damage, Dying on death) — kept
// here in case that split is ever wanted; currently empty since the user
// asked for every animation to be manually triggerable too.
export const AUTO_ONLY_ANIMATIONS = [];

export function speciesLabel(species) {
  return SPECIES[species]?.label || species;
}

export function animationsFor(species) {
  return Object.keys(SPECIES[species]?.frameCounts || { idle: 1 });
}

export function frameCount(species, animation) {
  return SPECIES[species]?.frameCounts[animation] || 1;
}

export function framePath(species, style, animation, frame) {
  return `/pets/${species}/${style}/${animation}/${frame}.webp`;
}

export function randomSpecies() {
  return SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)];
}
