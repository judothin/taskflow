# TaskFlow design system

One look for the whole app (and the WordPress panel). Light is the default;
people can pick Light / Dark / System and an accent colour, and optionally a
background image with frosted-glass surfaces. There is no other theme.

## Files

- `src/styles/tokens.css` — every colour, radius, easing. Never hard-code a
  colour in a page stylesheet except the fixed status / priority hues already
  defined there (`--st-*`, `--danger`, `--success`, `--chart`).
- `src/styles/base.css` — reset, `.eyebrow`, `.mono`, `.t-2/.t-3/.t-4`,
  `.prio-high`, `.truncate`, spinner, background-image layer.
- `src/styles/motion.css` — keyframes and `.anim-pop / .anim-rise / .stagger /
  .bump / .wiggle`.
- `src/styles/components.css` — buttons, fields, segmented, status grid,
  checkboxes, switch, tabs, tables, tags, avatars, cards, empty states,
  skeletons, sheet, dialog, menu, toast, dropzone, attachments, prose. The
  header comment is the index of class names.
- `src/styles/shell.css` — rail, top bar, pills, phone tab bar, "More" sheet.
- `src/styles/responsive.css` — phone rules for the shared components.
- `src/ui/` — React pieces with behaviour: `Icon`, `Sheet`, `Dialog`,
  `ConfirmDialog`, `Menu/MenuItem/useMenu`, `Segmented`, `Tabs`, `toast()`,
  `Avatar`, `AvatarStack`, `StatusLabel`, `StatusPicker`, `PageHeader`,
  `Empty`, `SearchInput`, `Dropzone`, `Lightbox`, `SheetLabel`, `CheckRow`,
  `SkeletonRows`, date helpers `shortDate / longDate / ago`, `fullName`.

## Look

- Inter for text, JetBrains Mono for labels, dates, counts, paths, codes.
- Page header: mono uppercase eyebrow (`.eyebrow`, e.g. `REVIEW`), a big
  40px semibold title (`.page-title`), a muted subtitle (`.page-sub`).
  Use `<PageHeader eyebrow title sub actions />`.
- Lists are tables: mono uppercase 11px column headers, 1px row dividers,
  hover tint, no cards around them. Group rows ("● Open 3") use
  `.table-group`. Set columns with `style={{ '--cols': '…' }}` on `.table`.
- Primary buttons are the accent (ink black by default) with a dim mono
  `⌘↵` hint where a shortcut exists. Secondary = white bordered. Ghost for
  tertiary. Danger actions are red text (`.btn-danger`) until confirmed.
- Choices: `Segmented` (selected = filled accent), `StatusPicker` (2×2 with
  dots, selected = dark outline), `.chip-toggle` pills for tags / sections /
  file types, round `.check-round` for pick lists (reviewers), `.check`
  squares for checklists.
- Opening a thing (task, review post, context entry, file) is a right-hand
  `Sheet`: mono eyebrow + ✕, a borderless big title (`.title-input`) and
  body (`.body-input`) on the left, metadata in the right `aside` with
  `SheetLabel`s, and a footer: meta note left, `Cancel` ghost + primary right.
  Full screen on phones.
- Status dots: `.dot-open` blue, `.dot-in_progress` orange, `.dot-on_hold`
  amber, `.dot-completed` green, `.dot-critical` red. Priority text:
  High / Critical red (`.prio-high`), others `t-3`.
- Dates are short and mono: `Oct 2`, `Mar 31, 2025`, `Oct 2, 2026 · 8:38 AM`.
- Avatars are small round warm-beige chips with mono initials, or the photo.
- Empty states: `<Empty icon title>` — calm, one line, optional action.

## Motion — bubbly but minimal

- Things that appear spring in (`--ease-spring`, small scale + overshoot):
  menus, popovers, dialogs, sheets, chips, toasts, badges.
- Things that move glide (`--ease-out`): page entrances, list rows
  (`.stagger` on the list container; add `.settled` after first paint if a
  re-render would replay it), sliding tab ink / segmented thumb.
- Things you press squish (`transform: scale(.96)` on `:active`) — buttons,
  chips, rows, checkboxes already do this.
- Counts bump (`key={count}` + `.bump`), errors wiggle (`.wiggle`),
  checkmarks pop (`.check`). Charts grow from their baseline, staggered.
- Every new element you add needs an entrance; nothing should just blink in.
  Respect `prefers-reduced-motion` (base.css handles it globally).

## Mobile

The whole app works on a phone (≤768px) — not a cut-down companion.
- The rail becomes a bottom tab bar (Home, Tasks, +, Review, More).
- Tables become stacked rows automatically (first cell full width, the rest
  wrap underneath). Hide low-value columns with `.hide-phone`.
- Sheets go full screen and slide up; their header bar drags down to close.
- Inputs are 16px on phones (no iOS zoom). Touch targets ≥ 38px.
- Two-column page layouts (list + detail, sidebar + content) collapse to one
  column; detail panes become a Sheet or a stacked section.

## Page conventions

- Page root: `<div className="page">` (`.page-narrow` for settings-like).
- Register top-bar actions with `<TopBarPortal>…</TopBarPortal>` from
  `context/HeaderActionsContext` (e.g. `New post`, `Add context`, search).
- Open a task from anywhere with `openTask(id)` / `openNewTask(prefill)`
  from `lib/events`. Toasts with `toast('Saved')`.
- Page-specific CSS goes in the page's own `.css` file, prefixed by a short
  page namespace (`.rv-`, `.ctx-`, `.fl-`, `.cp-`, `.ta-`, `.st-`).
