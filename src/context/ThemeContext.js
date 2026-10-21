import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Light / Dark / System. `mode` is the choice, `theme` what's showing.
// Light is the default. The choice is cached here (instant first paint, see
// public/index.html) and synced to the account by ThemeCustomizationContext.
const KEY = 'tf-theme-mode';
const ThemeContext = createContext({ mode: 'light', theme: 'light', setMode: () => {} });

const darkQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const normalizeMode = (m) => (m === 'dark' || m === 'system' ? m : 'light');
const resolve = (mode) => (mode === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : mode);

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try { return normalizeMode(localStorage.getItem(KEY)); } catch { return 'light'; }
  });
  const [systemDark, setSystemDark] = useState(() => !!darkQuery?.matches);

  useEffect(() => {
    if (!darkQuery) return undefined;
    const on = (e) => setSystemDark(e.matches);
    darkQuery.addEventListener('change', on);
    return () => darkQuery.removeEventListener('change', on);
  }, []);

  const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#111112' : '#ffffff');
  }, [theme]);

  const setMode = useCallback((m) => {
    const next = normalizeMode(m);
    setModeState(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => setMode(resolve(mode) === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
