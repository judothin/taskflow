import { useEffect } from 'react';

// ══════════════════════════════════════════════════════════════
// Swipe a bottom sheet down to dismiss it.
// --------------------------------------------------------------
// Every modal in the app already rises from the bottom on a phone (see the
// mobile block in index.css), which sets the expectation that it can be pushed
// back down — a sheet you can only close with an X reads as a dialog wearing a
// sheet's clothes.
//
// Applied by ModalPortal to whatever `.modal` it contains, so it reaches every
// modal at once rather than each one opting in.
//
// The rule that makes it feel right: the drag only starts when the sheet's own
// scroll is already at the top. Otherwise flicking down through a long form
// would drag the sheet away instead of scrolling it, which is the classic way
// this gesture goes wrong.
// ══════════════════════════════════════════════════════════════

const DISMISS_PX = 110;      // travel that commits to closing
const DISMISS_VELOCITY = 0.5; // px/ms — a fast flick closes early
const RESISTANCE = 0.55;      // upward drag barely moves: the sheet is at its top

export default function useSheetGestures(rootRef, onDismiss, enabled = true) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root || !onDismiss) return undefined;

    // Two sheet shapes in this app: .modal (every form) and .msheet (the
    // purpose-built bottom sheets).
    const sheet = root.querySelector('.modal, .msheet');
    if (!sheet) return undefined;
    // The scrolling part, if it has one. .msheet scrolls itself.
    const body = sheet.querySelector('.modal-body') || (sheet.classList.contains('msheet') ? sheet : null);

    let startY = 0;
    let startT = 0;
    let dy = 0;
    let dragging = false;

    const atTop = () => !body || body.scrollTop <= 0;

    const onStart = (e) => {
      if (!atTop()) return;
      startY = e.touches[0].clientY;
      startT = Date.now();
      dy = 0;
      dragging = true;
      sheet.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!dragging) return;
      // Scrolled away from the top mid-gesture — hand it back to the scroller.
      if (!atTop() && dy <= 0) { dragging = false; sheet.style.transform = ''; return; }
      const raw = e.touches[0].clientY - startY;
      dy = raw > 0 ? raw : raw * RESISTANCE;
      if (dy > 0) sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const velocity = dy / Math.max(Date.now() - startT, 1);
      sheet.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';

      if (dy > DISMISS_PX || velocity > DISMISS_VELOCITY) {
        // Carry it off the bottom, then let the caller unmount it.
        sheet.style.transform = `translate3d(0, ${sheet.offsetHeight}px, 0)`;
        setTimeout(onDismiss, 180);
      } else {
        sheet.style.transform = '';
      }
    };

    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: true });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);

    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [rootRef, onDismiss, enabled]);
}
