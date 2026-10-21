import { useEffect } from 'react';

// ══════════════════════════════════════════════════════════════
// Swipe a bottom sheet down to dismiss it.
// --------------------------------------------------------------
// Every modal in the app already rises from the bottom on a phone (see the
// mobile block in index.css), which sets the expectation that it can be pushed
// back down — a sheet you can only close with an X reads as a dialog wearing a
// sheet's clothes.
//
// Applied by ModalPortal to whatever sheet or dialog it contains.
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

    // Side sheets are full screen on a phone and full of fields, so only their
    // header bar drags. Dialogs and the "More" sheet drag from anywhere.
    const sheet = root.querySelector('.sheet, .dialog, .more-sheet');
    if (!sheet) return undefined;
    const isSide = sheet.classList.contains('sheet');
    const handle = isSide ? (sheet.querySelector('.sheet-head') || sheet) : sheet;
    const body = isSide ? null : sheet;

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

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove', onMove, { passive: true });
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('touchcancel', onEnd);

    return () => {
      handle.removeEventListener('touchstart', onStart);
      handle.removeEventListener('touchmove', onMove);
      handle.removeEventListener('touchend', onEnd);
      handle.removeEventListener('touchcancel', onEnd);
    };
  }, [rootRef, onDismiss, enabled]);
}
