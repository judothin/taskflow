import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyCachedThemeEarly } from './lib/themeColors';
import { captureNewTaskDeepLink } from './lib/deepLink';
import { watchForUpdates } from './lib/appUpdate';
import { preventZoom } from './lib/noZoom';

// No pinch or focus zoom on phones — see lib/noZoom.js.
preventZoom();

// Capture any ?new=1&page=…&feedback=…&noticed=… deep link before React/auth
// run, so the params survive a login redirect and the URL is stripped clean.
captureNewTaskDeepLink();

// Paint the user's real theme (incl. background image) before the first React
// render so reloads don't flash through white → black → image.
applyCachedThemeEarly();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Re-enable CSS transitions once the first frame has painted, so the instant
// boot (no fade) hands off to smooth theme-toggle transitions afterwards.
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.classList.remove('tf-boot');
}));

// Register the service worker so the app is installable ("Add to Home Screen")
// and its shell keeps working offline. Failures are non-fatal.
//
// Production only. The worker serves static files cache-first, which is safe
// for a build (every file name carries a content hash) but not for the dev
// server, whose /static/js/bundle.js keeps one name across edits — it served
// the previous build on every reload, so changes seemed not to land. In
// development, remove any worker an earlier session installed.
if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'production') {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
  if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Resuming an installed app doesn't re-navigate, so nothing would
      // otherwise ask whether a newer worker exists.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}

// An installed app is frozen and resumed rather than reloaded, so it can run a
// stale build indefinitely. See lib/appUpdate.js.
watchForUpdates();
