import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// An expanding panel that animates open and shut.
//
// The height is driven straight through the DOM rather than through React
// state, because a CSS transition needs the browser to have PAINTED the
// starting value before the ending value is set — and React gives no such
// guarantee. Setting `mounted` and then `height` lands both in one commit, the
// 0-height frame is never painted, and the panel snaps open with no transition
// at all. That was the bug in the state-driven version of this.
//
// `void el.offsetHeight` is the fix: reading a layout property forces the
// browser to flush pending style changes synchronously, so the 0px start is
// real by the time the target height is assigned one line later. It looks like
// a no-op and is load-bearing — the transition does not run without it.
//
// Two earlier approaches that did not hold up, so they don't come back:
//   - `{open && <div/>}` can only animate IN; React removes the node the
//     instant the flag flips, leaving nothing to transition out.
//   - `grid-template-rows: 0fr → 1fr` starts the transition on the same frames
//     the children are mounting, and on a phone that mount work overruns them.
export default function Collapse({ open, duration = 220, className = '', children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const timerRef = useRef(null);
  // Outlives `open` so the close has something to animate.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;

    clearTimeout(timerRef.current);

    if (open) {
      // Measure the children as they actually laid out. `overflow: hidden` on
      // the parent doesn't shrink them, so this is their natural height.
      const target = inner.offsetHeight;
      outer.style.height = '0px';
      void outer.offsetHeight; // paint the start — see above
      outer.style.height = `${target}px`;
      // Back to `auto` once open, so the panel still grows when the content
      // does (ticking an item can re-wrap a line and make it taller).
      timerRef.current = setTimeout(() => {
        if (outerRef.current) outerRef.current.style.height = 'auto';
      }, duration);
    } else {
      // `auto` → 0 doesn't transition either; there's no number to start from.
      outer.style.height = `${inner.offsetHeight}px`;
      void outer.offsetHeight;
      outer.style.height = '0px';
      timerRef.current = setTimeout(() => setMounted(false), duration);
    }

    return () => clearTimeout(timerRef.current);
  }, [open, mounted, duration]);

  if (!mounted) return null;

  return (
    <div
      ref={outerRef}
      className={`collapse ${open ? 'collapse-open' : ''} ${className}`}
      style={{ transitionDuration: `${duration}ms` }}
      aria-hidden={!open}
    >
      <div ref={innerRef} className="collapse-inner">{children}</div>
    </div>
  );
}
