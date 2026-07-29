import React, { useState } from 'react';
import './Dashboard.css';
import './Help.css';

const Icon = ({ d, size = 16, strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((path, i) => <path key={i} d={path} />)}
  </svg>
);

const Poly = ({ points, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={points} />
  </svg>
);

const STATUSES = [
  { label: 'Critical',    color: '#f87171', border: 'rgba(239,68,68,0.35)',   desc: 'Urgent — always pinned to the top of every task list regardless of sort order' },
  { label: 'Open',        color: '#60a5fa', border: 'rgba(59,130,246,0.35)',  desc: 'Logged and waiting to be picked up' },
  { label: 'In Progress', color: '#fbbf24', border: 'rgba(245,158,11,0.35)', desc: 'Actively being worked on — only one task can be In Progress at a time' },
  { label: 'On Hold',     color: '#a78bfa', border: 'rgba(120,78,160,0.35)', desc: 'Paused — blocked or deprioritised temporarily' },
  { label: 'Completed',   color: '#4ade80', border: 'rgba(34,197,94,0.35)',  desc: 'Done — moved to the Completed archive' },
];

const ROI_LEVELS = [
  { label: 'Critical', color: '#f87171', desc: 'Must fix — business-blocking or severe UX break' },
  { label: 'High',     color: '#fbbf24', desc: 'Strong impact, should be prioritised soon' },
  { label: 'Medium',   color: '#60a5fa', desc: 'Worth doing, but not time-sensitive' },
  { label: 'Low',      color: '#4ade80', desc: 'Nice to have, tackle when capacity allows' },
];

const COMPLEXITY_LEVELS = [
  { label: 'High',   color: '#f87171', desc: 'Significant effort — large refactor, complex logic, or cross-system changes' },
  { label: 'Medium', color: '#fbbf24', desc: 'Moderate effort — multiple components or a few hours of work' },
  { label: 'Low',    color: '#4ade80', desc: 'Quick fix — a small change, copy edit, or minor UI tweak' },
];

const SIDEBAR_ACTIONS = [
  {
    icon: ['M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7', 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'],
    name: 'Edit',
    desc: 'Opens the full edit form — change any field including status, page, feedback, ROI, complexity, and screenshot',
    color: 'var(--text-muted)',
  },
  {
    icon: ['M22 11.08V12a10 10 0 11-5.93-9.14', 'M22 4L12 14.01 9 11.01'],
    name: 'Quick Complete',
    desc: 'Mark as done without opening the full form. A popover lets you tick one or more team members who completed it',
    color: '#4ade80',
  },
  {
    icon: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
    name: 'Add to Queue',
    desc: 'Queue the task for next. Turns into a remove button (shown as ✕) when already queued. Highlighted in accent colour when active',
    color: '#60a5fa',
  },
  {
    icon: ['M3 6h18', 'M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6', 'M10 11v6M14 11v6', 'M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2'],
    name: 'Delete',
    desc: 'Permanently removes the task. Requires a second click to confirm — the button changes to a tick and a cancel option',
    color: '#f87171',
  },
];

const SHORTCUTS = [
  { keys: ['/'], name: 'Search', desc: 'Open the global search palette to jump to any task, project, file, or submission.' },
  { keys: ['n'], name: 'New Task', desc: 'Open the New Task form from anywhere in the app.' },
  { keys: ['q'], name: 'Quick Log', desc: 'Open the Quick Log modal to record a completed task fast.' },
];

const CHANGELOG_1_8_0 = [
  {
    group: 'Dashboard',
    items: [
      'Status filters — click any stat card, or use the status buttons (All, Critical, Open, In Progress, On Hold, Completed) above the task list, to filter; the two stay in sync. Click again to clear.',
      'New "Current Focus" bar — shows the in-progress task plus the next queued ones (up to 3), in queue order. Only the active one is tagged "In Progress", the rest show "Up Next".',
      'Reordering the queue in the sidebar now reorders the Current Focus bar live, and all its cards share the same height.',
      'Calendar widget replaces the Projects panel — defaults to today, and picking any date shows the tasks completed that day with a "View all" link.',
      'Completion activity chart now shows one month at a time as a wide calendar grid and defaults to your own activity (switch to anyone or everyone).',
      'Wider right sidebar for more breathing room.',
    ],
  },
  {
    group: 'Completed page',
    items: [
      'Fully redesigned — calendar on the left, results list on the right.',
      'Opens to today\'s completions by default — click "View all completed tasks" to see everything.',
      'Filter by person or date, search across tasks, and sort by newest or oldest completed.',
      'Calendar markers use the selected person\'s colour (dark purple when viewing everyone) and show how many tasks were done each day.',
    ],
  },
  {
    group: 'Tasks & checklists',
    items: [
      'New tasks pre-fill "Noticed By" with your name (still editable).',
      'Checkboxes in task feedback are now interactive everywhere — tick them on cards and completed rows, not just in detail view.',
      'Checkbox changes save for everyone and stay recorded after a task is completed.',
    ],
  },
  {
    group: 'Quick Log',
    items: [
      'Quick Log is now available from the Completed page too, not just the Dashboard.',
      'The Page / Area carries over to your next entry, while "What was done" and "Completed By" reset — faster for logging several items in the same area.',
    ],
  },
  {
    group: 'Navigation',
    items: [
      'Refreshing a page keeps you where you are; opening the app in a new tab always starts on the Dashboard.',
      'Tasteful, subtle animations added across the new calendar, focus bar, filters, and lists.',
    ],
  },
];

const CHANGELOG_1_9_0 = [
  {
    group: 'Build your own dashboard',
    items: [
      'New "Edit Dashboard" button at the top — turns the dashboard into an editable grid where every section becomes a tile you can rearrange.',
      'Drag tiles to reorder them, and resize each one to 1/3, 1/2, or full width — or move it into the right sidebar.',
      'Add or remove widgets from the "Add Widget" menu. The Current Focus bar and All Tasks list are always kept (locked), and the task-count stats plus the calendar stay pinned in place.',
      'Widgets sitting side by side now automatically match each other\'s height.',
      'Your layout saves to your account and stays identical on every device you sign in on — changes save automatically.',
    ],
  },
  {
    group: 'New widgets',
    items: [
      'Notification Center, Your Activity (your personal completion chart), Completed Today, ROI Breakdown, Team Leaderboard (completions this week), Recent Activity, Completion Streak, Projects, and Queue.',
      'Mix and match — add the ones you care about, size them how you like, and drop the rest.',
    ],
  },
  {
    group: 'Notification Center',
    items: [
      'A live activity feed — get notified about completed tasks, newly created tasks, project comments, guest submissions, and new files.',
      'An Apple-style unread badge sits on the bell, and each notification type has its own colour — completed tasks show in red so they grab attention.',
      'Two tabs: "Unread" (the default) and "All" for everything you\'ve ever received.',
      'Click any notification to open a detail popup — a task shows its page, status, ROI, who completed it, and a jump-to link.',
      'Notifications only clear when you open one or hit "Mark all read".',
      'A settings panel (the gear icon) lets you choose which event types notify you, and for completed tasks, whether it\'s everyone or only specific people. Your choices sync across devices too.',
    ],
  },
  {
    group: 'Queue widget',
    items: [
      'An optional dashboard widget for your up-next queue — reorder by dragging or remove an item with a single click.',
      'Stays perfectly in sync with the sidebar queue and the Current Focus bar — change it in one place and it updates everywhere.',
    ],
  },
];

const CHANGELOG_2_0_0 = [
  {
    group: 'Make it yours — full theme customization',
    items: [
      'New Theme & Colors panel in Settings: recolor the background, secondary/accent, borders, text, and each status colour — changes apply instantly.',
      'The secondary colour now drives buttons, links, highlights and the activity chart together.',
      'Choose your logo tint (Auto / White / Black).',
      'Accessibility: pick a text size (Small → Extra Large) and a bold-text option.',
      'Everything syncs to your account, so your look follows you across devices. The light/dark toggle steps aside once you set your own background or text colour.',
    ],
  },
  {
    group: 'Background images & glass',
    items: [
      'Upload and save up to 10 background images and set one as your app background — synced across your devices.',
      'When a background is on, the whole UI turns to frosted glass so it shows through beautifully.',
      'Dial in the exact look with Glass opacity and Glass blur sliders.',
    ],
  },
  {
    group: 'Saved themes',
    items: [
      'Save your current colours, background and text settings as a named theme, then apply or delete it anytime.',
      'Deleting a background that a theme uses warns you first; it keeps working from cache, and falls back gracefully if the cache is cleared.',
    ],
  },
  {
    group: 'A dashboard that\'s truly yours',
    items: [
      'Everything on the dashboard is now removable and rearrangeable except the locked task-count bar at the top — click a count to jump into Active Tasks filtered by it.',
      'Side-by-side widgets match heights, and your layout syncs across devices.',
    ],
  },
  {
    group: 'Navigation & pages',
    items: [
      'Collapsible sidebar — tap the little arrow tab to collapse it to icons or expand it, and it remembers your choice.',
      'Hovering a collapsed icon shows a themed tooltip.',
      'New dedicated Active Tasks page in the nav, with full search, filters and sorting.',
      'An optional live date & time readout in the top bar of every page.',
    ],
  },
  {
    group: 'Notifications & tasks',
    items: [
      'Notification Center adds Unread / All tabs, and what you\'ve read now syncs across devices.',
      '"Critical" now includes critical-ROI tasks too — they\'re counted and pinned to the top alongside critical-status tasks.',
      'Pasted feedback (e.g. from Word) is cleaned up automatically to match the app\'s theme.',
    ],
  },
];

const CHANGELOG_2_1_0 = [
  {
    group: 'Ranks & badges',
    items: [
      'Earn ranks automatically as you use TaskFlow — Level badges (Bronze → Supreme) as you level up, Tenure badges for how long you\'ve been a member, and Task badges for hitting completion milestones (5 all the way to 1,000).',
      'Your completed tasks are now counted automatically toward the Task badges.',
      'See every badge — earned and locked — in the new Ranks & Badges section in Settings, and click any earned badge to choose which ones show in the top bar.',
    ],
  },
  {
    group: 'A brand-new top bar',
    items: [
      'Every page now has a persistent, frosted top bar showing where you are (breadcrumb), your rank badges, your level progress, and a live date & time.',
      'Page actions moved up here too — New Task, Quick Log, Edit Dashboard, New Project and more now live in the top bar, so each page starts right at its content.',
      'Cleaner pages overall: the big page titles and empty header space are gone.',
    ],
  },
  {
    group: 'Your Stats',
    items: [
      'A new stats card is permanently pinned to Settings, showing your total Tasks Completed and Tasks Created.',
      'Prefer it on your dashboard? Add the new "Your Stats" widget from the Add Widget menu — resize and place it wherever you like.',
    ],
  },
  {
    group: 'Pomodoro',
    items: [
      'A dedicated Pomodoro page with your in-progress and queued tasks alongside the timer.',
      'A Pomodoro widget for the dashboard, with custom focus and break lengths.',
    ],
  },
  {
    group: 'Pets, XP & rewards',
    items: [
      'Food & water are now an inventory you earn from creating and completing tasks and from leveling up — spend them to feed and water your pet, complete with a fill animation.',
      'More ways to earn XP: daily streaks, clearing critical tasks, your first task of the day, and queue completions.',
      'Pets no longer lose condition over the weekend.',
    ],
  },
  {
    group: 'Get things done faster',
    items: [
      'Bulk actions — hit "Select" on any task-card view to multi-select and add to queue, complete, or delete in one go.',
      'Universal search — press / to open a command palette and jump to any task, project, file, or submission.',
      'Keyboard shortcuts: / to search, n for a new task, q for Quick Log.',
    ],
  },
  {
    group: 'Tasks & cards',
    items: [
      'Subtasks & checklists inside any task, with progress shown right on the card and expanded by default.',
      'Inline quick-edit on cards — change page, project, ROI, status, or add a subtask without opening the task; dropdowns have background blur and smooth open/close animations.',
    ],
  },
  {
    group: 'Smoother all around',
    items: [
      'Reloads are instant now — no white/black flash, the page just appears.',
      'Subtle entrance animations across the app so content eases in instead of snapping.',
    ],
  },
];

const RELEASES = [
  { version: 'v2.1.0', title: "What's New", sub: 'Ranks & badges, a new top bar, stats, Pomodoro & more', groups: CHANGELOG_2_1_0 },
  { version: 'v2.0.0', title: 'Previous update', sub: 'Personalize everything — themes, backgrounds & more', groups: CHANGELOG_2_0_0 },
  { version: 'v1.9.0', title: 'Previous update', sub: 'Customizable dashboard, widgets & notifications', groups: CHANGELOG_1_9_0 },
  { version: 'v1.8.0', title: 'Previous update', sub: 'Dashboard, Completed page & queue improvements', groups: CHANGELOG_1_8_0 },
];

const SECTIONS = [
  { id: 'whatsnew',    label: "What's New" },
  { id: 'overview',    label: 'Overview' },
  { id: 'shortcuts',   label: 'Keyboard Shortcuts' },
  { id: 'statuses',    label: 'Statuses, ROI & Complexity' },
  { id: 'cards',       label: 'Task Cards' },
  { id: 'creating',    label: 'Creating & Editing' },
  { id: 'queue',       label: 'Queue' },
  { id: 'dashboard',   label: 'Dashboard' },
  { id: 'tasks',       label: 'All Tasks' },
  { id: 'completed',   label: 'Completed' },
  { id: 'guest',       label: 'Guest Portal' },
  { id: 'settings',    label: 'Settings' },
  { id: 'appearance',  label: 'Appearance' },
];

export default function Help() {
  const [activeSection, setActiveSection] = useState('whatsnew');
  const [openVersions, setOpenVersions] = useState({ [RELEASES[0].version]: true });

  const toggleVersion = (v) => setOpenVersions(o => ({ ...o, [v]: !o[v] }));

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="dashboard fade-in">

      {/* Mobile horizontal nav — visible only on small screens */}
      <div className="help-mobile-nav">
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={e => { e.preventDefault(); scrollTo(s.id); }}
            className={`help-mobile-nav-item ${activeSection === s.id ? 'help-mobile-nav-active' : ''}`}
          >
            {s.label}
          </a>
        ))}
      </div>

      <div className="help-layout">

        {/* Sticky desktop nav */}
        <div className="help-sticky-nav">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SECTIONS.map(s => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={e => { e.preventDefault(); scrollTo(s.id); }}
                style={{
                  padding: '7px 12px',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: activeSection === s.id ? 'var(--accent)' : 'var(--text-muted)',
                  background: activeSection === s.id ? 'var(--accent-glow)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                  borderLeft: activeSection === s.id ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="help-content">

          {/* ── What's New ── */}
          <section id="whatsnew" className="help-section">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {RELEASES.map((release, idx) => {
                const open = !!openVersions[release.version];
                return (
                  <div key={release.version} className={`whatsnew ${open ? 'whatsnew-open' : ''}`}>
                    <button className="whatsnew-header" onClick={() => toggleVersion(release.version)} aria-expanded={open}>
                      <span className="whatsnew-spark">
                        {idx === 0 ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                          </svg>
                        )}
                      </span>
                      <div className="whatsnew-headings">
                        <span className="whatsnew-title">{release.title}</span>
                        <span className="whatsnew-sub">{release.sub}</span>
                      </div>
                      <span className="whatsnew-version">{release.version}</span>
                      <span className="whatsnew-chevron">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </span>
                    </button>

                    <div className="whatsnew-body">
                      <div className="whatsnew-body-inner">
                        {release.groups.map(group => (
                          <div key={group.group} className="whatsnew-group">
                            <div className="whatsnew-group-title">{group.group}</div>
                            <ul className="whatsnew-list">
                              {group.items.map((item, i) => (
                                <li key={i} className="whatsnew-item">
                                  <svg className="whatsnew-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Overview ── */}
          <section id="overview" className="help-section">
            <h2 className="help-section-title">Overview</h2>

            <div className="help-info-card">
              <span className="help-info-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </span>
              <div className="help-info-card-body">
                <div className="help-info-card-title">What is TaskFlow?</div>
                <div className="help-info-card-desc">
                  TaskFlow is an internal ticket and task tracker for managing feedback, bugs, and improvements. Team members can log issues, assign priority levels, queue up work, and track completion — all in one place.
                </div>
              </div>
            </div>

            <div className="help-grid">
              {[
                {
                  icon: ['M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z', 'M9 22V12h6v10'],
                  title: 'Dashboard',
                  desc: 'Your home base. Stats at a glance, In Progress tasks featured, completion activity chart, and the full active task grid.',
                },
                {
                  icon: ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2', 'M9 5a2 2 0 002 2h2a2 2 0 002-2'],
                  title: 'All Tasks',
                  desc: 'Full list of every task. Filter by status tab, ROI, or keyword. Sort by date, ROI, or status.',
                },
                {
                  icon: ['M22 11.08V12a10 10 0 11-5.93-9.14', 'M22 4L12 14.01l-3-3'],
                  title: 'Completed',
                  desc: 'Archive of everything that\'s been finished. Filter by person, date range, and sort by completion date or name.',
                },
                {
                  icon: ['M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6', 'M15 3h6v6', 'M10 14L21 3'],
                  title: 'Guest Portal',
                  desc: 'A public form at /submit. Anyone can log feedback without an account. Submissions land as Open tasks.',
                },
              ].map(item => (
                <div key={item.title} className="help-card">
                  <div className="help-card-header">
                    <div className="help-card-icon">
                      <Icon d={item.icon} size={15} />
                    </div>
                    <div className="help-card-title">{item.title}</div>
                  </div>
                  <div className="help-card-desc">{item.desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Keyboard Shortcuts ── */}
          <section id="shortcuts" className="help-section">
            <h2 className="help-section-title">Keyboard Shortcuts</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Press a single key from anywhere in the app to work faster. Shortcuts are ignored while you're typing in a text field, so they never get in the way.
            </p>

            <div className="help-grid">
              {SHORTCUTS.map(sc => (
                <div key={sc.name} className="help-card">
                  <div className="help-card-header">
                    <div style={{ display: 'flex', gap: 4 }}>
                      {sc.keys.map(k => <span key={k} className="help-kbd">{k}</span>)}
                    </div>
                    <div className="help-card-title">{sc.name}</div>
                  </div>
                  <div className="help-card-desc">{sc.desc}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Statuses, ROI & Complexity ── */}
          <section id="statuses" className="help-section">
            <h2 className="help-section-title">Statuses, ROI & Complexity</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Every task carries three classification fields. The card border colour always reflects its current <strong style={{ color: 'var(--text)' }}>status</strong> so you can scan a page instantly.
            </p>

            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, fontStyle: 'italic' }}>Task statuses — reflected as a coloured border on each card</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
                {STATUSES.map(s => (
                  <div key={s.label} className="help-ref-item" style={{ borderColor: s.border }}>
                    <div className="help-ref-swatch" style={{ background: s.color }} />
                    <span className="help-ref-label">{s.label}</span>
                    <span className="help-ref-desc">{s.desc}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, fontStyle: 'italic' }}>ROI levels — shown as a coloured badge on every card</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
                {ROI_LEVELS.map(r => (
                  <div key={r.label} className="help-ref-item">
                    <div className="help-ref-swatch" style={{ background: r.color }} />
                    <span className="help-ref-label">{r.label}</span>
                    <span className="help-ref-desc">{r.desc}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, fontStyle: 'italic' }}>Complexity — shown as a grey badge alongside ROI</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {COMPLEXITY_LEVELS.map(c => (
                  <div key={c.label} className="help-ref-item">
                    <div className="help-ref-swatch" style={{ background: c.color }} />
                    <span className="help-ref-label">{c.label}</span>
                    <span className="help-ref-desc">{c.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="help-info-card">
              <span className="help-info-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </span>
              <div className="help-info-card-body">
                <div className="help-info-card-title">Critical status is special</div>
                <div className="help-info-card-desc">
                  Tasks with a <strong style={{ color: '#f87171' }}>Critical</strong> status are always sorted to the very top of the Dashboard and All Tasks lists, regardless of any other sort order. Critical tasks can also be added to the queue like any other task.
                </div>
              </div>
            </div>
          </section>

          {/* ── Task Cards ── */}
          <section id="cards" className="help-section">
            <h2 className="help-section-title">Task Cards</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Each card shows the ROI badge, complexity badge, status badge, the affected page, the feedback description, who noticed the issue, and the date received. The <strong style={{ color: 'var(--text)' }}>action bar</strong> sits on the right edge of every card.
            </p>

            <div className="help-actions-list">
              {SIDEBAR_ACTIONS.map(action => (
                <div key={action.name} className="help-action-row">
                  <div className="help-action-btn-mock" style={{ color: action.color, borderColor: 'var(--border)' }}>
                    <Icon d={action.icon} size={13} />
                  </div>
                  <div className="help-action-text">
                    <div className="help-action-name">{action.name}</div>
                    <div className="help-action-desc">{action.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                    </svg>
                  </div>
                  <div className="help-card-title">URL auto-detection</div>
                </div>
                <div className="help-card-desc">
                  The Page field accepts either plain text (e.g. "Checkout") or a full URL. If a URL is entered, the card renders a clickable link showing just the hostname and path. If it's plain text, it shows as-is with a document icon.
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Screenshots</div>
                </div>
                <div className="help-card-desc">Attach a PNG, JPG, or WebP screenshot (max 1 MB) to any task. When attached, an "attachment" badge appears on the card — click it to view full-screen in a modal.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Quick Complete</div>
                </div>
                <div className="help-card-desc">
                  Click the circle-check icon to open a popover directly on the card. Tick one or more team members who completed it, then hit Confirm. Closes automatically if you click outside. Not shown on already-completed tasks.
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M8 12H3M21 12h-5M12 8V3M12 21v-5"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Right-click context menu</div>
                </div>
                <div className="help-card-desc">Right-click any row on the Completed page, or any item in the queue sidebar, to get a context menu with Edit and Delete options.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Status colour coding</div>
                </div>
                <div className="help-card-desc">The thin border surrounding every card is coloured to match the task's current status — red for critical, blue for open, amber for in progress, purple for on hold, green for completed.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/>
                      <path d="M8 21h8M12 17v4"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Featured cards</div>
                </div>
                <div className="help-card-desc">In Progress tasks are shown in a larger "featured" card style on the Dashboard's In Progress section, giving them more visual prominence than standard grid cards.</div>
              </div>
            </div>
          </section>

          {/* ── Creating & Editing ── */}
          <section id="creating" className="help-section">
            <h2 className="help-section-title">Creating & Editing Tasks</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              New tasks can be created from the Dashboard or All Tasks page using the <strong style={{ color: 'var(--text)' }}>New Task</strong> button. Editing opens the same form pre-filled with existing values.
            </p>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Task form fields</div>
                </div>
                <div className="help-card-desc">Every task has: Status, Page (name or URL), Feedback / Issue description, Noticed By, ROI level, Complexity level, and an optional screenshot attachment.</div>
                <div className="help-card-tips">
                  <div className="help-tip"><span className="help-tip-dot" />Status defaults to Open for new tasks</div>
                  <div className="help-tip"><span className="help-tip-dot" />Page accepts plain text or a full URL — both are valid</div>
                  <div className="help-tip"><span className="help-tip-dot" />Screenshot is optional, max 1 MB (PNG, JPG, WebP)</div>
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Marking as complete</div>
                </div>
                <div className="help-card-desc">When you change a task's status to Completed in the edit form, a second modal appears asking who completed the task. Select one or more team members using the checkbox list, then confirm.</div>
                <div className="help-card-tips">
                  <div className="help-tip"><span className="help-tip-dot" />At least one person must be selected to confirm</div>
                  <div className="help-tip"><span className="help-tip-dot" />Multiple completors are stored as a comma-separated list</div>
                  <div className="help-tip"><span className="help-tip-dot" />Date completed is recorded automatically</div>
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Deleting from the form</div>
                </div>
                <div className="help-card-desc">A Delete button appears at the bottom-left of the edit form. Clicking it reveals a confirmation step — you must click "Yes, delete" to permanently remove the task.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Screenshot upload</div>
                </div>
                <div className="help-card-desc">Click the screenshot drop zone to choose a file. A preview appears immediately. Click ✕ on the preview to remove it. The existing screenshot is preserved on edit unless you remove it.</div>
              </div>
            </div>

            <div className="help-info-card">
              <span className="help-info-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </span>
              <div className="help-info-card-body">
                <div className="help-info-card-title">Text selection in forms</div>
                <div className="help-info-card-desc">
                  You can freely highlight and copy text inside form fields without the modal closing. The modal only closes when you click the background overlay — not when you drag to select text.
                </div>
              </div>
            </div>
          </section>

          {/* ── Queue ── */}
          <section id="queue" className="help-section">
            <h2 className="help-section-title">The Queue</h2>

            <div className="help-info-card">
              <span className="help-info-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                  <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                  <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </span>
              <div className="help-info-card-body">
                <div className="help-info-card-title">How the queue works</div>
                <div className="help-info-card-desc">
                  The queue lives in the sidebar and shows tasks lined up to be worked on. Only one task can be <strong style={{ color: '#fbbf24' }}>In Progress</strong> at a time. When that task is completed or moved off, the first item in the queue is automatically promoted to In Progress.
                </div>
              </div>
            </div>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Adding to queue</div>
                </div>
                <div className="help-card-desc">Click the queue icon in the card action bar. Available for Open, On Hold, and Critical tasks. If nothing is currently In Progress, the task is promoted immediately instead of being queued.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Removing from queue</div>
                </div>
                <div className="help-card-desc">When a task is queued, the queue icon on the card turns accent-coloured and changes to a ✕. Click it again to remove the task from the queue. You can also right-click a queue item in the sidebar.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Drag to reorder</div>
                </div>
                <div className="help-card-desc">Drag any item in the queue sidebar up or down to reposition it. Drop it onto another item to slot it before that item, or drag to the bottom drop zone to move it to the end of the queue.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Auto-promotion</div>
                </div>
                <div className="help-card-desc">Whenever the current In Progress task is completed, moved to On Hold, or moved back to Open (via the edit form), the first item in the queue is automatically promoted to In Progress.</div>
              </div>
            </div>
          </section>

          {/* ── Dashboard ── */}
          <section id="dashboard" className="help-section">
            <h2 className="help-section-title">Dashboard</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Your home screen. Shows a personalised greeting based on time of day and a count of currently In Progress tasks.
            </p>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Status counters</div>
                </div>
                <div className="help-card-desc">Five stat cards across the top show live counts for Critical, Open, In Progress, On Hold, and Completed tasks. Numbers update whenever a task changes status.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div className="help-card-title">In Progress section</div>
                </div>
                <div className="help-card-desc">If any tasks are In Progress, they appear in a featured card section below the stats. These cards are larger and more prominent than the standard grid below.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Completion activity chart</div>
                </div>
                <div className="help-card-desc">A bar chart showing completed tasks over time. Use the team member dropdown above the chart to filter by a specific person and see only their completions.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Task grid with search</div>
                </div>
                <div className="help-card-desc">All active (non-completed) tasks shown in a 3-column grid. Search by page name, feedback text, or noticed-by name. Critical tasks are always pinned to the top of the grid.</div>
              </div>
            </div>
          </section>

          {/* ── All Tasks ── */}
          <section id="tasks" className="help-section">
            <h2 className="help-section-title">All Tasks</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              The full task list including all statuses. A task count is shown in the page subtitle and updates as filters change.
            </p>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Status tabs</div>
                </div>
                <div className="help-card-desc">Click a tab to filter to that status: All Tasks, Critical, Open, In Progress, On Hold, or Completed. Each tab shows a live count badge. The All Tasks tab pins critical tasks to the top.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                  </div>
                  <div className="help-card-title">ROI filter</div>
                </div>
                <div className="help-card-desc">A dropdown lets you narrow results to a specific ROI level: Critical, High, Medium, or Low. Combines with the status tab and search box — all three filters work together.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Search</div>
                </div>
                <div className="help-card-desc">Search by page name, feedback text, or the name of who noticed the issue. The results update in real-time as you type and respect any active status tab or ROI filter.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Sort options</div>
                </div>
                <div className="help-card-desc">Sort by: Newest First (date received, descending), Oldest First (ascending), By ROI (critical → low), or By Status (alphabetical). Critical tasks always stay pinned at the top when viewing All Tasks.</div>
              </div>
            </div>
          </section>

          {/* ── Completed ── */}
          <section id="completed" className="help-section">
            <h2 className="help-section-title">Completed</h2>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              An archive of every finished task. The total completion count is shown in the page subtitle.
            </p>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Person summary cards</div>
                </div>
                <div className="help-card-desc">At the top of the page, a row of cards shows each team member who has completions, with their avatar and completion count. Click a card to filter the list to only their completions — click again to clear.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Date filter</div>
                </div>
                <div className="help-card-desc">Filter by when the task was completed: All Time, Today, Yesterday, Last 7 Days, Last 30 Days, or This Month. Combines with the person filter and search.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Sort options</div>
                </div>
                <div className="help-card-desc">Sort completed tasks by: Completion Date (newest or oldest), By Person (alphabetical), or Received Date (newest first). Default is completion date descending.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Edit & Delete sidebar</div>
                </div>
                <div className="help-card-desc">Each completed row has an action sidebar on the right — the same as task cards. Click the edit icon to re-open the full edit form, or use the delete button (requires confirmation) to remove the record permanently.</div>
              </div>
            </div>
          </section>

          {/* ── Guest Portal ── */}
          <section id="guest" className="help-section">
            <h2 className="help-section-title">Guest Portal</h2>

            <div className="help-info-card">
              <span className="help-info-card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                </svg>
              </span>
              <div className="help-info-card-body">
                <div className="help-info-card-title">Public submission form</div>
                <div className="help-info-card-desc">
                  The Guest Portal at <span className="help-kbd">/submit</span> is a standalone public page — no login required. Share it with clients, stakeholders, or anyone who needs to report an issue. Submissions appear as Open tasks in the main task list.
                </div>
              </div>
            </div>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Form fields</div>
                </div>
                <div className="help-card-desc">Guests fill in: Page (which page or area is affected), Feedback / Issue description, their Name, Priority (ROI), Complexity, and an optional screenshot. All submissions default to Open status.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Screenshot attachment</div>
                </div>
                <div className="help-card-desc">Guests can optionally attach a screenshot (PNG, JPG, or WebP, max 1 MB) to their submission. The image is stored and viewable on the task card once submitted.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Success state</div>
                </div>
                <div className="help-card-desc">After submitting, a confirmation screen is shown. The guest can click "Submit Another" to file a second task, or follow the sign-in link if they have a team account.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Accessing the portal</div>
                </div>
                <div className="help-card-desc">The "Guest Portal" link at the bottom of the sidebar opens <span className="help-kbd">/submit</span> in a new tab. Share this URL directly with anyone who needs to report issues.</div>
              </div>
            </div>
          </section>

          {/* ── Settings ── */}
          <section id="settings" className="help-section">
            <h2 className="help-section-title">Settings</h2>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Profile information</div>
                </div>
                <div className="help-card-desc">Update your first and last name. Your name appears on task completion records and in the "Completed By" field, so keep it accurate for team reporting.</div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Profile colour</div>
                </div>
                <div className="help-card-desc">Pick from 10 preset colours or use the custom colour picker for any hex value. Your colour is used for your avatar throughout the app and on the completion activity chart.</div>
                <div className="help-card-tips">
                  <div className="help-tip"><span className="help-tip-dot" />A live preview of your avatar updates as you pick</div>
                  <div className="help-tip"><span className="help-tip-dot" />Colour change takes effect site-wide on save</div>
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Change password</div>
                </div>
                <div className="help-card-desc">Enter a new password and confirm it. Minimum 6 characters. You don't need your old password — just the new one and a confirmation. Takes effect immediately on save.</div>
              </div>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section id="appearance" className="help-section">
            <h2 className="help-section-title">Appearance</h2>

            <div className="help-grid">
              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Light / Dark mode</div>
                </div>
                <div className="help-card-desc">Toggle between dark and light theme using the sun/moon switch at the bottom of the sidebar. The transition is smooth — no flash. Your preference is saved and persists across sessions and page reloads.</div>
                <div className="help-card-tips">
                  <div className="help-tip"><span className="help-tip-dot" />Dark mode is the default</div>
                  <div className="help-tip"><span className="help-tip-dot" />Preference stored in localStorage — survives refreshes</div>
                  <div className="help-tip"><span className="help-tip-dot" />The logo inverts automatically in light mode</div>
                </div>
              </div>

              <div className="help-card">
                <div className="help-card-header">
                  <div className="help-card-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                    </svg>
                  </div>
                  <div className="help-card-title">Theme toggle location</div>
                </div>
                <div className="help-card-desc">The toggle is in the sidebar footer — look for the sun icon on the left and moon icon on the right, with a sliding pill between them. Click anywhere on the control to switch.</div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

