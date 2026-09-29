import { useLayoutEffect, useRef, useState } from 'react';

// ============================================================
// Animated keyed list
// ------------------------------------------------------------
// For lists that change because data arrived — a task queued, one started,
// one finished — rather than because the user dragged something. Rows that
// appear animate in, rows that disappear stay on screen long enough to
// animate out, and everything else slides to its new place instead of
// jumping. Nothing is asked of the caller when the data changes: positions
// are measured after every commit and compared with the last one.
//
//   const { list, rowRef } = useAnimatedList(items, i => i.id);
//   list.map(({ item, key, phase }) => (
//     <div key={key} ref={rowRef(key)} className={`row al-${phase}`} />
//   ))
//
// `phase` is 'enter', 'exit' or 'idle'; the al-enter / al-exit animations
// live in index.css. A leaving row is rendered from its last data and
// should ignore input (al-exit does that). Nothing animates on the first
// render, or when the viewer prefers reduced motion.
// ============================================================

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function useAnimatedList(items, getKey, { exitMs = 340, enterMs = 420, moveMs = 360 } = {}) {
  const committed = useRef(null);          // [{ key, item }] as last rendered (no exits)
  const exiting = useRef(new Map());       // key -> { item, index }
  const entering = useRef(new Map());      // key -> timeout
  const nodes = useRef(new Map());         // key -> element
  const setters = useRef(new Map());       // key -> stable ref callback
  const positions = useRef(new Map());     // key -> { x, y } (layout, not visual)
  const [, rerender] = useState(0);

  const current = items.map(item => ({ key: getKey(item), item }));
  const keys = new Set(current.map(c => c.key));
  const prev = committed.current;
  const animate = prev !== null && !reducedMotion();

  if (animate) {
    // Newly missing → start leaving. (A ref write during render, but an
    // idempotent one: a second render pass finds them already leaving.)
    prev.forEach((p, index) => {
      if (!keys.has(p.key) && !exiting.current.has(p.key)) exiting.current.set(p.key, { item: p.item, index });
    });
    // Newly present → entering; a row that comes back mid-exit just stays.
    const prevKeys = new Set(prev.map(p => p.key));
    current.forEach(c => {
      if (exiting.current.has(c.key)) exiting.current.delete(c.key);
      else if (!prevKeys.has(c.key) && !entering.current.has(c.key)) entering.current.set(c.key, null);
    });
  }

  // Leaving rows sit where they were, so nothing jumps while they go.
  const list = current.map(c => ({ ...c, phase: entering.current.has(c.key) ? 'enter' : 'idle' }));
  [...exiting.current.entries()]
    .sort((a, b) => a[1].index - b[1].index)
    .forEach(([key, { item, index }]) => {
      list.splice(Math.min(index, list.length), 0, { key, item, phase: 'exit' });
    });

  const rowRef = (key) => {
    let set = setters.current.get(key);
    if (!set) {
      set = (el) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); };
      setters.current.set(key, set);
    }
    return set;
  };

  useLayoutEffect(() => {
    committed.current = current;

    // Retire leavers and enterers on timers (a re-render mid-animation must
    // not strip the class and cut it short).
    exiting.current.forEach((v, key) => {
      if (v.timer) return;
      v.timer = setTimeout(() => { exiting.current.delete(key); rerender(n => n + 1); }, exitMs);
    });
    entering.current.forEach((t, key) => {
      if (t) return;
      entering.current.set(key, setTimeout(() => entering.current.delete(key), enterMs));
    });

    // Slide rows that moved. Layout offsets ignore transforms, so a slide in
    // progress doesn't throw the measurement off.
    const moved = [];
    nodes.current.forEach((el, key) => {
      const now = { x: el.offsetLeft, y: el.offsetTop };
      const before = positions.current.get(key);
      positions.current.set(key, now);
      if (!animate || !before) return;
      const dx = before.x - now.x;
      const dy = before.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(el);
    });
    [...positions.current.keys()].forEach(k => { if (!nodes.current.has(k)) positions.current.delete(k); });
    if (!moved.length) return;
    void moved[0].getBoundingClientRect(); // register the start before releasing it
    requestAnimationFrame(() => {
      moved.forEach(el => {
        el.style.transition = `transform ${moveMs}ms ${EASE}`;
        el.style.transform = '';
        setTimeout(() => { el.style.transition = ''; }, moveMs + 40);
      });
    });
  });

  useLayoutEffect(() => () => {
    exiting.current.forEach(v => clearTimeout(v.timer));
    entering.current.forEach(t => clearTimeout(t));
  }, []);

  return { list, rowRef };
}
