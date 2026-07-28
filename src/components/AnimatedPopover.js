import React, { useState, useEffect, useRef } from 'react';

// Wraps a conditionally-shown popover so it animates BOTH in and out. While
// `open` is true it mounts and transitions to the `pop-in` state; when `open`
// flips false it transitions to `pop-out` and only unmounts after `duration`.
// Forwards a ref to the rendered element so callers can keep using it for
// outside-click detection.
const AnimatedPopover = React.forwardRef(function AnimatedPopover(
  { open, className = '', duration = 150, children, ...rest },
  ref
) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  const rafRef = useRef();

  useEffect(() => {
    if (open) {
      setRender(true);
      // Double rAF so the initial pop-out state paints before we flip to
      // pop-in — otherwise the browser collapses both into one frame (no anim).
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(rafRef.current);
    }
    setShown(false);
    const t = setTimeout(() => setRender(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);

  if (!render) return null;

  return (
    <div ref={ref} className={`${className} pop-anim ${shown ? 'pop-in' : 'pop-out'}`} {...rest}>
      {children}
    </div>
  );
});

export default AnimatedPopover;
