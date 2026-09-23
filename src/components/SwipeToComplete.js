import React, { useRef, useState } from 'react';

// ══════════════════════════════════════════════════════════════
// Swipe a row to the right to complete it.
// --------------------------------------------------------------
// The gesture every list-shaped task app has converged on, and the reason
// they all have it: ticking things off is the single most repeated action,
// and a swipe is the only interaction that costs no aim at all.
//
// Three details separate one that feels right from one that fights you:
//
//   1. Axis lock. The first few pixels decide whether this is a swipe or a
//      scroll, and once decided it never changes for that gesture. Without
//      the lock, a slightly diagonal scroll drags rows sideways and the list
//      feels broken. `touch-action: pan-y` lets the browser own vertical
//      scrolling natively (so it stays at 60fps on the compositor) while
//      handing us horizontal movement.
//   2. Resistance past the threshold. Travel keeps responding but slows down,
//      which communicates "this is armed" through the finger rather than
//      through a label.
//   3. Commit animates OUT, it doesn't snap back. Releasing past the
//      threshold sends the row the rest of the way off, so the action reads
//      as completed before the list has even re-rendered.
// ══════════════════════════════════════════════════════════════

// Fraction of the row's width the finger has to travel to arm the action.
// Generous on purpose: completing the wrong task is worse than a swipe that
// doesn't take.
const COMMIT_AT = 0.38;
// Movement before we decide swipe-vs-scroll. Too small and a scroll gets
// caught; too large and the row lags the finger on a real swipe.
const AXIS_LOCK_PX = 10;
// Past the commit point the row keeps moving, at a third speed.
const RESISTANCE = 0.34;

export default function SwipeToComplete({ onCommit, disabled = false, children }) {
  const [dx, setDx] = useState(0);
  const [released, setReleased] = useState(false);
  const [gone, setGone] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef(null); // null | 'x' | 'y'
  const width = useRef(1);
  const el = useRef(null);

  const commitDistance = () => width.current * COMMIT_AT;
  const armed = dx >= commitDistance();

  const onTouchStart = (e) => {
    if (disabled || gone) return;
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    axis.current = null;
    width.current = el.current?.offsetWidth || 1;
    setReleased(false);
  };

  const onTouchMove = (e) => {
    if (disabled || gone) return;
    const t = e.touches[0];
    const moveX = t.clientX - startX.current;
    const moveY = t.clientY - startY.current;

    if (axis.current === null) {
      if (Math.abs(moveX) < AXIS_LOCK_PX && Math.abs(moveY) < AXIS_LOCK_PX) return;
      // Whichever axis the finger committed to first owns the whole gesture.
      axis.current = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
    }
    if (axis.current !== 'x') return;

    // Right only. A left swipe would need a second action behind it, and a
    // hidden destructive one is how people delete things by accident.
    if (moveX <= 0) { setDx(0); return; }

    const commit = commitDistance();
    setDx(moveX <= commit ? moveX : commit + (moveX - commit) * RESISTANCE);
  };

  const onTouchEnd = () => {
    if (disabled || gone) return;
    const wasArmed = dx >= commitDistance();
    axis.current = null;
    setReleased(true); // hands control to CSS for the settle

    if (wasArmed) {
      setGone(true);
      setDx(width.current); // carry it the rest of the way off
      // Let the exit play before the list mutates underneath it.
      setTimeout(() => onCommit?.(), 190);
    } else {
      setDx(0);
    }
  };

  // Track brightens as you approach, then holds once armed.
  const progress = Math.min(dx / Math.max(commitDistance(), 1), 1);

  return (
    <div className="swipe" ref={el}>
      <div
        className={`swipe-track ${armed ? 'swipe-track-armed' : ''}`}
        style={{ opacity: progress > 0 ? 0.35 + progress * 0.65 : 0 }}
        aria-hidden="true"
      >
        <span className="swipe-icon" style={{ transform: `scale(${0.6 + progress * 0.4})` }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      </div>

      <div
        className={`swipe-surface ${released ? 'swipe-surface-settling' : ''}`}
        style={{ transform: dx ? `translate3d(${dx}px, 0, 0)` : undefined }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
