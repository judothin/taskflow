import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { loadPrefsCache, savePrefsCache, normalizePrefs, DEFAULT_DISPLAY } from '../lib/dashboardLayout';
import { fetchUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';

// Exposes the top-bar date/time preference to the whole app (it's edited from
// the dashboard's edit mode but displayed on every page via Layout). The value
// lives inside the dashboard prefs payload ({ blocks, display }); writing it
// preserves the current blocks by reading them from the cache.
const TopBarContext = createContext({ display: DEFAULT_DISPLAY, setDisplayPref: () => {} });
export const useTopBar = () => useContext(TopBarContext);

export function TopBarProvider({ children }) {
  const { user } = useAuth();
  const uid = user?.id;
  const [display, setDisplay] = useState(() => loadPrefsCache(uid).display);

  useEffect(() => {
    if (!uid) { setDisplay({ ...DEFAULT_DISPLAY }); return; }
    let cancelled = false;
    setDisplay(loadPrefsCache(uid).display);
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.dashboard_layout) {
        setDisplay(normalizePrefs(prefs.dashboard_layout).display);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const setDisplayPref = useCallback((next) => {
    setDisplay(prev => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      const blocks = loadPrefsCache(uid).blocks; // preserve current layout
      const prefs = { blocks, display: merged };
      savePrefsCache(uid, prefs);
      saveUserPrefsDebounced(uid, { dashboard_layout: prefs });
      return merged;
    });
  }, [uid]);

  return (
    <TopBarContext.Provider value={{ display, setDisplayPref }}>
      {children}
    </TopBarContext.Provider>
  );
}
