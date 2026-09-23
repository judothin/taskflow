import { useSyncExternalStore } from 'react';

// True at phone widths. 768px matches the breakpoint Layout.css already uses
// to swap the sidebar for the bottom dock, so JS and CSS agree on what a
// phone is — if that number moves, move it in both places.
//
// One shared MediaQueryList for the whole app rather than one per component:
// TaskCard asks this on every card, and dozens of independent listeners for
// the same query is wasted work.
const QUERY = '(max-width: 768px)';
const mql = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia(QUERY)
  : null;

function subscribe(onChange) {
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const getSnapshot = () => (mql ? mql.matches : false);
const getServerSnapshot = () => false;

export default function useIsPhone() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
