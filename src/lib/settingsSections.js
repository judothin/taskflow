// ============================================================
// Settings sections registry
// ------------------------------------------------------------
// One entry per section of the Settings page, in nav order. Lives here
// rather than in the page so other surfaces can address sections without
// importing the page itself — global search lists them as destinations, and
// anything linking to a section uses `sectionPath()`.
//
// `icon` is a name from src/ui/Icon.js.
// ============================================================

export const SETTINGS_SECTIONS = [
  {
    id: 'profile',
    label: 'Profile',
    blurb: 'Your name, photo, and the color that represents you.',
    icon: 'user',
  },
  {
    id: 'account',
    label: 'Account',
    blurb: 'Your email, password, and signing out.',
    icon: 'lock',
  },
  {
    id: 'teams',
    label: 'Teams',
    blurb: 'Members, invites, the guest portal, and team-wide settings.',
    icon: 'users',
  },
  {
    id: 'presets',
    label: 'Subtask presets',
    blurb: 'Reusable checklists your team can drop into any task.',
    icon: 'list',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'Light or dark, your accent colour, and a background image.',
    icon: 'contrast',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    blurb: 'Text size, weight, motion, and what shows on your screen.',
    icon: 'accessibility',
  },
];

export const SETTINGS_SECTION_IDS = SETTINGS_SECTIONS.map(s => s.id);

export const DEFAULT_SETTINGS_SECTION = 'profile';

// Old links (?section=achievements) and unknown values fall back to the
// first section rather than rendering an empty panel.
export function resolveSettingsSection(id) {
  return SETTINGS_SECTION_IDS.includes(id) ? id : DEFAULT_SETTINGS_SECTION;
}

export function sectionPath(id) {
  return `/settings?section=${id}`;
}
