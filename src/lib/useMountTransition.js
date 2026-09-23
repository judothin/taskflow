import { useEffect, useState } from 'react';

// Keeps an element mounted for `duration` after `open` flips false, so it can
// animate OUT instead of vanishing. Conditionally-rendered elements can only
// ever animate in — the moment the flag goes false React removes the node and
// there's nothing left to transition.
//
//   const { mounted, shown } = useMountTransition(open);
//   {mounted && <div className={shown ? 'panel panel-open' : 'panel'} />}
//
// `shown` flips one frame after mounting so the closed state paints first —
// without that the browser collapses both into a single frame and there's no
// transition at all. Same double-rAF trick AnimatedPopover uses.
export default function useMountTransition(open, duration = 240) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);

  return { mounted, shown };
}
