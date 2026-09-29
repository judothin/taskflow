// ============================================================
// No zoom on touch devices
// ------------------------------------------------------------
// The viewport meta (public/index.html) covers Android and iOS's zoom-on-
// focus, but iOS Safari ignores `user-scalable=no` for pinching — on
// purpose, since iOS 10 — so a pinch still zooms the whole app, home-screen
// install included. The only thing that stops it is cancelling the gesture
// ourselves.
//
// Touch-only: desktop trackpad pinch (ctrl+wheel) is left alone.
// ============================================================

export function preventZoom() {
  if (typeof window === 'undefined') return;
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!touch) return;

  // iOS Safari's own pinch events.
  const cancel = (e) => e.preventDefault();
  document.addEventListener('gesturestart', cancel, { passive: false });
  document.addEventListener('gesturechange', cancel, { passive: false });
  document.addEventListener('gestureend', cancel, { passive: false });

  // Two fingers moving = a pinch everywhere else. One finger is a scroll or
  // a swipe and must pass through untouched.
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Double-tap zoom is handled in CSS (`touch-action: manipulation` on
  // html, index.css). Cancelling a fast second tap here instead would also
  // eat real rapid taps — ticking two checklist items in a row.
}
