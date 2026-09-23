import React, { useEffect, useRef, useState } from 'react';

// An expanding panel that animates open AND shut, smoothly.
//
// Two earlier attempts at this misbehaved, and both failure modes are worth
// recording so they don't get reintroduced:
//
//   - Conditional rendering ({open && <div/>}) can only ever animate IN. The
//     moment the flag flips false React removes the node, so there is nothing
//     left to transition out.
//   - `grid-template-rows: 0fr → 1fr` animates to a content-derived height
//     without measuring, but it starts the transition on the same frames the
//     children are mounting. On a phone that mount work regularly overruns the
//     two frames available, so the transition is half-skipped and the panel
//     appears to pop — the "glitchy" open.
//
// So: mount the children first with the panel collapsed, measure them, and
// only then animate to a real pixel height. Once open it switches to `auto` so
// the panel still grows when the content inside it does (ticking a subtask
// re-wraps a line, adding one makes it taller).
export default function Collapse({ open, duration = 260, className = '', children }) {
  const inner = useRef(null);
  // `mounted` outlives `open` so the close can animate.
  const [mounted, setMounted] = useState(open);
  // null = collapsed, a number = mid-animation, 'auto' = settled open.
  const [height, setHeight] = useState(open ? 'auto' : null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    const el = inner.current;
    if (!mounted || !el) return undefined;

    let frame;
    let timer;

    if (open) {
      // Children are in the DOM now, so this height is real.
      setHeight(el.scrollHeight);
      // Hand back to `auto` once we've arrived, so later content changes
      // aren't pinned to a stale pixel value.
      timer = setTimeout(() => setHeight('auto'), duration);
    } else {
      // Going from 'auto' straight to 0 doesn't transition — there's no
      // starting number to interpolate from. Pin the current height, let that
      // paint, then collapse on the next frame.
      setHeight(el.scrollHeight);
      frame = requestAnimationFrame(() => requestAnimationFrame(() => setHeight(null)));
      timer = setTimeout(() => setMounted(false), duration);
    }

    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [open, mounted, duration]);

  if (!mounted) return null;

  return (
    <div
      className={`collapse ${open ? 'collapse-open' : ''} ${className}`}
      style={{
        height: height === 'auto' ? 'auto' : `${height || 0}px`,
        transitionDuration: `${duration}ms`,
      }}
      aria-hidden={!open}
    >
      <div ref={inner} className="collapse-inner">{children}</div>
    </div>
  );
}
