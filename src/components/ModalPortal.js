import { useEffect, useRef } from 'react';
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
export default function ModalPortal({ children, onDismiss }) {
  const elRef = useRef(null);
  // Phones only: a sheet you can push back down. Opt-in per modal, because
  // only the caller knows how to close itself.
  useSheetGestures(elRef, onDismiss, useIsPhone());

  if (!elRef.current) {
    elRef.current = document.createElement('div');
    elRef.current.className = 'modal-portal';
  }

  useEffect(() => {
    const el = elRef.current;
    document.body.appendChild(el);
    lockScroll();
    return () => {
      unlockScroll();
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  return createPortal(children, elRef.current);
}
