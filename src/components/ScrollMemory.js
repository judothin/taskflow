import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Remembers where you were on each screen and puts you back when you return.
//
// Without this, opening the eighth task in a list and pressing back drops you
// at the top, and you have to find your place again — which is the single most
// common way a web app gives itself away on a phone.
//
// The rule is the one native navigation uses: going BACK restores, going
// somewhere new starts at the top. React Router reports which happened via
// useNavigationType (POP is back/forward), so a fresh push to the same path
// still lands at the top rather than inheriting an old offset.
//
// sessionStorage, not state: it survives a refresh within the tab and is gone
// in a new one, which matches how far "where I was" should reasonably reach.
const KEY = 'tf-scroll';

function readAll() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

export default function ScrollMemory() {
  const { pathname } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    // Record continuously — a screen can be left by a tap, the back gesture or
    // the dock, and there's no single moment to hook.
    const save = () => {
      try {
        const all = readAll();
        all[pathname] = window.scrollY;
        sessionStorage.setItem(KEY, JSON.stringify(all));
      } catch { /* storage full or blocked — position is not worth failing for */ }
    };

    window.addEventListener('scroll', save, { passive: true });
    return () => {
      save(); // one last time on the way out
      window.removeEventListener('scroll', save);
    };
  }, [pathname]);

  useEffect(() => {
    if (navType !== 'POP') {
      window.scrollTo(0, 0);
      return;
    }
    const y = readAll()[pathname];
    if (typeof y !== 'number') return;
    // Wait for the incoming screen to have laid out, or there's nothing to
    // scroll to yet. Two frames covers the mount plus its first data paint.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
  }, [pathname, navType]);

  return null;
}
