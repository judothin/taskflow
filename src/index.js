import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyCachedThemeEarly } from './lib/themeColors';
import { captureNewTaskDeepLink } from './lib/deepLink';

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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
