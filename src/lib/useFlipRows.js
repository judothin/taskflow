import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const DURATION = 240;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

// Added to a row for the length of its slide. Rows cross each other on the way
// past, so a list whose rows have a transparent background styles this class
// opaque to stop the two showing through one another.
const SLIDING_CLASS = 'flip-sliding';

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// FLIP slide for a keyed list that reorders itself — a subtask sinking to the
// bottom as it's checked off. Explicit rather than automatic: the caller calls
// capture() immediately before the state change that reorders the rows, so the
// hook reads layout only when something is actually about to move (a card's
// checklist re-renders far more often than it reorders).
//
//   const { rowRef, capture } = useFlipRows();
//   <li key={item.id} ref={rowRef(item.id)} />   // register each row
//   capture(); setItems(reordered);              // then reorder
//
// Rows that weren't on screen before the reorder simply appear; nothing slides
// at all when the viewer prefers reduced motion. Each row carries the
// `flip-sliding` class while it moves.
export default function useFlipRows({ duration = DURATION } = {}) {
  const nodes   = useRef(new Map()); // id -> element
  const setters = useRef(new Map()); // id -> stable ref callback
  const pending = useRef(null);      // id -> top, captured pre-reorder
  const timers  = useRef(new Map()); // id -> inline-style cleanup timeout
  const alive   = useRef(true);

  // One stable ref callback per id, so registering a row doesn't churn on
  // every render.
  const rowRef = useCallback((id) => {
    let set = setters.current.get(id);
    if (!set) {
      set = (el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); };
      setters.current.set(id, set);
    }
    return set;
  }, []);

  const capture = useCallback(() => {
    if (reduceMotion()) return;
    const tops = new Map();
    nodes.current.forEach((el, id) => tops.set(id, el.getBoundingClientRect().top));
    pending.current = tops;
  }, []);

  // Runs after every render but bails on the first line unless capture() armed
  // it — no layout thrash on ordinary re-renders.
  useLayoutEffect(() => {
    const before = pending.current;
    if (!before) return;
    pending.current = null;

    const moved = [];
    nodes.current.forEach((el, id) => {
      const from = before.get(id);
      if (from == null) return; // row is new — it just appears
      const delta = from - el.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;

      // Invert: put the row back where it was. Neither checklist stylesheet
      // transitions `transform`, so this lands instantly with no transition to
      // suppress — an in-flight slide is the one exception, and clearing the
      // inline transition first stops it dead at its current spot.
      clearTimeout(timers.current.get(id));
      el.style.transition = '';
      el.style.transform = `translateY(${delta}px)`;
      el.classList.add(SLIDING_CLASS);
      moved.push([id, el]);
    });
    if (!moved.length) return;

    // Play: a frame later, release to the real position and let CSS interpolate.
    // Deliberately not cancelled on cleanup — this effect re-runs on every
    // render, and cancelling would strand the row at its inverted offset.
    requestAnimationFrame(() => {
      if (!alive.current) return;
      moved.forEach(([id, el]) => {
        el.style.transition = `transform ${duration}ms ${EASING}`;
        el.style.transform = '';
        // Hand styling back to the stylesheet once the slide is done.
        timers.current.set(id, setTimeout(() => {
          el.style.transition = '';
          el.classList.remove(SLIDING_CLASS);
          timers.current.delete(id);
        }, duration + 50));
      });
    });
  });

  // Stop touching rows once the list is gone.
  useEffect(() => {
    const t = timers.current;
    const a = alive;
    a.current = true;
    return () => { a.current = false; t.forEach(clearTimeout); t.clear(); };
  }, []);

  return { rowRef, capture };
}
