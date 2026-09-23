// ============================================================
// Settings sections registry
// ------------------------------------------------------------
// One entry per section of the Settings page, in nav-rail order. Lives here
// rather than in the page so other surfaces can address sections without
// importing the page itself — global search lists them as destinations, and
// anything linking to a section uses `sectionPath()`.
//
// `icon` is one or more 24×24 SVG subpaths joined by " M".
// ============================================================

export const SETTINGS_SECTIONS = [
  {
    id: 'profile',
    label: 'Profile',
    blurb: 'Your name, photo, and the color that represents you.',
    icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 3a4 4 0 100 8 4 4 0 000-8z',
  },
  {
    id: 'account',
    label: 'Account',
    blurb: 'Sign-in details and a snapshot of your activity.',
    icon: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 0110 0v4',
  },
  {
    id: 'teams',
    label: 'Teams',
    blurb: 'Members, invites, the guest portal, and team-wide settings.',
    icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75 M9 11a4 4 0 100-8 4 4 0 000 8z',
  },
  {
    id: 'presets',
    label: 'Subtask Presets',
    blurb: 'Reusable checklists your team can drop into any task.',
    icon: 'M9 11l3 3 8-8 M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    blurb: 'Colors, background image, and saved themes.',
    icon: 'M12 2a10 10 0 000 20c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.7 4.7 0 0022 12c0-5.5-4.5-10-10-10z M7.5 11.5a1 1 0 100-2 1 1 0 000 2z',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    blurb: 'Text size and weight across the app.',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 7v.01 M11 11h1v5h1',
  },
  {
    id: 'achievements',
    label: 'Achievements',
    blurb: 'XP, levels, and the badges on your top bar.',
    icon: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 01-10 0z M7 6H4v2a3 3 0 003 3 M17 6h3v2a3 3 0 01-3 3',
  },
];

export const SETTINGS_SECTION_IDS = SETTINGS_SECTIONS.map(s => s.id);

export const DEFAULT_SETTINGS_SECTION = 'profile';

// The section actually shown for a given ?section= value — unknown or missing
// falls back to the first one rather than rendering an empty panel.
export function resolveSettingsSection(id) {
  return SETTINGS_SECTION_IDS.includes(id) ? id : DEFAULT_SETTINGS_SECTION;
}

export function sectionPath(id) {
  return `/settings?section=${id}`;
}
