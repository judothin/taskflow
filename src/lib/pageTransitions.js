import { flushSync } from 'react-dom';
import { createBrowserHistory } from '@remix-run/router';

// ============================================================
// Page transitions
// ------------------------------------------------------------
// Every navigation slides the page content sideways — forward into a new
// page, back out of one — while the sidebar, top bar, phone header and dock
// stay exactly where they are.
//
// How: App.js routes through this history instead of BrowserRouter's own
// (same `createBrowserHistory({ v5Compat: true })` BrowserRouter uses). Its
// `listen` is wrapped so the router's state update runs inside
// document.startViewTransition(): the browser snapshots the current screen,
// React renders the new page synchronously (flushSync), and CSS animates old
// → new (see PageTransitions.css). The chrome has its own
// view-transition-names, so it's never part of the slide.
//
// No View Transitions support (older iOS / Firefox) → a CSS slide-in on the
// new page instead. Reduced motion → no animation at all.
// ============================================================

// Where each top-level page sits, left to right. Moving to a page further
// along slides forward (in from the right); moving back along slides back.
// Follows the phone dock's order first, then the rest of the sidebar.
const ORDER = [
  'dashboard', 'focus', 'active', 'tasks', 'completed', 'stats', 'quicklog',
  'projects', 'files', 'context', 'go-live', 'pomodoro', 'submissions',
  'settings', 'appearance', 'help',
];

const segments = (path) => path.split('/').filter(Boolean);

export function navDirection(from, to, action) {
  const a = segments(from);
  const b = segments(to);
  // Deeper (a task opened from a list) is forward; shallower is back.
  if (b.length !== a.length) return b.length > a.length ? 'forward' : 'back';
  const ia = ORDER.indexOf(a[0] || 'dashboard');
  const ib = ORDER.indexOf(b[0] || 'dashboard');
  if (ia !== -1 && ib !== -1 && ia !== ib) return ib > ia ? 'forward' : 'back';
  // Sideways between siblings (one task to another) — browser Back reads as
  // going back, everything else as forward.
  return action === 'POP' ? 'back' : 'forward';
}

let seq = 0; // which transition is the latest

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Replays the fallback slide on the page container (it persists between
// pages, so the class has to be pulled and re-added to restart it).
function fallbackSlide(dir) {
  const el = document.querySelector('.page-content');
  if (!el) return;
  el.classList.remove('page-enter-forward', 'page-enter-back');
  void el.offsetWidth; // restart the animation
  el.classList.add(`page-enter-${dir}`);
}

// A change WITHIN a page — a Settings tab — as its own transition: the page
// stays put and only the part named for it crossfades (PageTransitions.css,
// data-nav-dir="section"). `dir` is 'down' or 'up' through the list. Returns
// false, having just run `change`, when there's no transition to run it in.
export function sectionTransition(dir, change) {
  if (!document.startViewTransition || reducedMotion()) { change(); return false; }
  const root = document.documentElement;
  const mine = ++seq;
  root.dataset.navDir = 'section';
  root.dataset.sectionDir = dir;
  const vt = document.startViewTransition(() => { flushSync(change); });
  vt.finished.finally(() => {
    if (mine === seq) { delete root.dataset.navDir; delete root.dataset.sectionDir; }
  });
  return true;
}

export const appHistory = createBrowserHistory({ v5Compat: true });

let lastPath = appHistory.location.pathname;
const baseListen = appHistory.listen.bind(appHistory);

appHistory.listen = (apply) => baseListen((update) => {
  const from = lastPath;
  const to = update.location.pathname;
  lastPath = to;

  // Same page with a new query or state (a settings tab, a filter) — no slide.
  // Outside the app shell (login, guest portal) there's no page to slide.
  const inShell = !!document.querySelector('.page-content');
  if (from === to || !inShell || reducedMotion()) { apply(update); return; }

  const dir = navDirection(from, to, update.action);
  const root = document.documentElement;

  if (!document.startViewTransition) {
    apply(update);
    requestAnimationFrame(() => fallbackSlide(dir));
    return;
  }

  const mine = ++seq;
  root.dataset.navDir = dir;
  // The old page's snapshot is drawn in the NEW page's box. A forward
  // navigation scrolls to the top as it renders, so without this a page you'd
  // scrolled down would jump to show its top half on the way out. Offset it
  // by how far the box moved, so it leaves from exactly where it was.
  const pageTop = () => document.querySelector('.page-content')?.getBoundingClientRect().top ?? 0;
  const oldTop = pageTop();
  const vt = document.startViewTransition(() => {
    flushSync(() => apply(update));
    root.style.setProperty('--vt-old-dy', `${oldTop - pageTop()}px`);
  });
  vt.finished.finally(() => {
    // A newer navigation may have started its own transition meanwhile —
    // leave its direction alone.
    if (mine === seq) {
      delete root.dataset.navDir;
      root.style.removeProperty('--vt-old-dy');
    }
  });
});
