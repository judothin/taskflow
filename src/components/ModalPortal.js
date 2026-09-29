import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useSheetGestures from './SheetGestures';
import useIsPhone from '../lib/useIsPhone';

// ── Page scroll lock ──────────────────────────────────────────
// Locking `body` alone does nothing here. The browser only propagates the
// body's overflow to the viewport when <html>'s own overflow is `visible`,
// and index.css sets `html { overflow-x: clip }` — so <html> is the real
// scroller and `body { overflow: hidden }` just clips the body box.
//
// Ref-counted rather than saved per instance: modals nest (an image zoom over
// a task form, a confirm over a sheet), and whichever one unmounts first would
// otherwise restore scrolling while the other is still open.
let lockCount = 0;
let saved = null;

function lockScroll() {
  if (lockCount++ > 0) return;
  const doc = document.documentElement;
  // Measured before hiding, while the scrollbar is still laid out.
  const scrollbar = window.innerWidth - doc.clientWidth;

  saved = {
    htmlOverflow: doc.style.overflow,
    bodyOverflow: document.body.style.overflow,
    bodyPadding: document.body.style.paddingRight,
  };

  doc.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  // Removing the scrollbar widens the page by its width, which shifts the
  // whole layout sideways behind the overlay. Hold the space it vacated.
  if (scrollbar > 0) {
    const current = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.paddingRight = `${current + scrollbar}px`;
  }
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0 || !saved) return;
  document.documentElement.style.overflow = saved.htmlOverflow;
  document.body.style.overflow = saved.bodyOverflow;
  document.body.style.paddingRight = saved.bodyPadding;
  saved = null;
}

/**
 * Renders its children into a dedicated node appended to <body>, escaping any
 * ancestor stacking context or CSS transform/filter that would otherwise
 * re-anchor a `position: fixed` overlay to the card it lives in (which breaks
 * both centering and z-index layering). Every modal in the app should render
 * through this so `.modal-overlay` is always positioned against the viewport.
 *
 * Also freezes the page behind it — see the scroll lock above.
 */
// ── Exit animation ────────────────────────────────────────────
// Modals are mounted with `{open && <ModalPortal>…}`, so on close React
// removes them in one go and there's nothing left to animate — they just
// vanished. Rather than giving every modal in the app its own closing state,
// the portal leaves a frozen copy of itself behind: an inert clone of the DOM
// it was showing, which plays the exit (index.css, .modal-portal-exit) and
// then removes itself. The clone can't be clicked and isn't read out.
//
// Two timing details make or break this:
//   - The copy is taken in a LAYOUT effect's cleanup. React empties the
//     portal before plain effect cleanups run, so copying there found nothing
//     and the exit silently never played.
//   - It's only shown once the portal is really gone. In development React
//     mounts everything twice (StrictMode), and the throwaway first unmount
//     used to play a close animation over the modal as it opened — the
//     stutter on open. If the portal is back by the time the copy would
//     show, it was one of those, and the copy is dropped.
const EXIT_MS = 200;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function snapshot(el) {
  if (!el.firstChild || reducedMotion()) return null;
  const clone = el.cloneNode(true);
  // A clone starts scrolled to the top. Note where long modals were, to put
  // them back once the clone is on the page (a detached node can't scroll).
  const scrolls = [];
  el.querySelectorAll('*').forEach((node, i) => { if (node.scrollTop) scrolls.push([i, node.scrollTop]); });
  return { clone, scrolls };
}

function playExit(snap) {
  const { clone, scrolls } = snap;
  clone.classList.add('modal-portal-exit');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  document.body.appendChild(clone);
  if (scrolls.length) {
    const nodes = clone.querySelectorAll('*');
    scrolls.forEach(([i, top]) => { if (nodes[i]) nodes[i].scrollTop = top; });
  }
  setTimeout(() => clone.remove(), EXIT_MS + 40);
}

// `animateExit={false}` for anything that animates its own close (search).
export default function ModalPortal({ children, onDismiss, animateExit = true }) {
  const elRef = useRef(null);
  const animateExitRef = useRef(animateExit);
  animateExitRef.current = animateExit;
  // Phones only: a sheet you can push back down. Opt-in per modal, because
  // only the caller knows how to close itself.
  useSheetGestures(elRef, onDismiss, useIsPhone());

  if (!elRef.current) {
    elRef.current = document.createElement('div');
    elRef.current.className = 'modal-portal';
  }

  // Copy the modal while it's still there (see "Exit animation" above).
  const exitSnap = useRef(null);
  useLayoutEffect(() => {
    const el = elRef.current;
    return () => { exitSnap.current = animateExitRef.current ? snapshot(el) : null; };
  }, []);

  useEffect(() => {
    const el = elRef.current;
    document.body.appendChild(el);
    lockScroll();
    return () => {
      unlockScroll();
      if (el.parentNode) el.parentNode.removeChild(el);
      const snap = exitSnap.current;
      exitSnap.current = null;
      // After the current commit: a StrictMode re-mount will have put the
      // portal back by then, and there's nothing to animate.
      if (snap) queueMicrotask(() => { if (!el.isConnected) playExit(snap); });
    };
  }, []);

  return createPortal(children, elRef.current);
}
