import { useLayoutEffect } from 'react';

// Places a `position: fixed` popover next to the element that opened it and
// keeps it fully on screen — the fix for popovers anchored to some ancestor
// (and so landing far from their button, or off the top of the window).
//
// Opens on the `side` you ask for (right by default), vertically centred on
// the anchor. Only if it genuinely doesn't fit there does it flip to the
// other side; either way it's clamped inside the viewport with `margin` to
// spare, and slid up or down rather than cut off. Re-placed on scroll and
// resize for as long as it's open. Writes straight to the element's style —
// no re-render per scroll event.
//
//   useAnchoredPosition(open, buttonRef, popoverRef);
export default function useAnchoredPosition(open, anchorRef, popRef, { side: preferred = 'right', gap = 10, margin = 10 } = {}) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    let raf = 0;

    const place = () => {
      const anchor = anchorRef.current;
      const pop = popRef.current;
      // The popover can mount a frame after `open` flips (AnimatedPopover).
      if (!anchor || !pop) { raf = requestAnimationFrame(place); return; }

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Work out how CSS pixels on the popover map to screen pixels, by
      // putting it at two known spots and seeing where it actually lands.
      // The app's text-size setting scales the whole page with CSS `zoom`,
      // and browsers disagree on whether getBoundingClientRect() and
      // `left`/`top` are in zoomed pixels or not — which put the popover in
      // the wrong place (over the card's own buttons) at any size but
      // Default. Measuring sidesteps all of that.
      pop.style.left = '0px';
      pop.style.top = '0px';
      const o = pop.getBoundingClientRect();
      pop.style.left = '100px';
      const k = (pop.getBoundingClientRect().left - o.left) / 100 || 1;
      const toCssX = (x) => (x - o.left) / k;
      const toCssY = (y) => (y - o.top) / k;

      pop.style.maxHeight = `${(vh - margin * 2) / k}px`;
      const a = anchor.getBoundingClientRect();
      const w = pop.offsetWidth * k;  // on-screen size
      const h = pop.offsetHeight * k;

      const rightLeft = a.right + gap;
      const leftLeft = a.left - gap - w;
      const fitsRight = rightLeft + w <= vw - margin;
      const fitsLeft = leftLeft >= margin;
      let side = preferred;
      if (side === 'right' && !fitsRight && fitsLeft) side = 'left';
      else if (side === 'left' && !fitsLeft && fitsRight) side = 'right';
      let left = side === 'right' ? rightLeft : leftLeft;
      left = Math.min(Math.max(left, margin), Math.max(margin, vw - margin - w));

      let top = a.top + a.height / 2 - h / 2;
      top = Math.min(Math.max(top, margin), Math.max(margin, vh - margin - h));

      pop.style.left = `${Math.round(toCssX(left))}px`;
      pop.style.top = `${Math.round(toCssY(top))}px`;
      // Grow out of the point nearest the button, wherever clamping put it.
      const originY = Math.min(Math.max(a.top + a.height / 2 - top, 0), h) / k;
      pop.style.transformOrigin = `${side === 'left' ? 'right' : 'left'} ${Math.round(originY)}px`;
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, popRef, preferred, gap, margin]);
}
