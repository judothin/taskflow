import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { supabase } from '../lib/supabase';
import {
  applyThemeColors, clearThemeColors, effectiveColor, loadThemeCache, saveThemeCache,
  cacheBackgroundImage,
} from '../lib/themeColors';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';

const MAX_BACKGROUNDS = 10;

const Ctx = createContext({});
export const useThemeCustomization = () => useContext(Ctx);

export function ThemeCustomizationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { theme } = useTheme();
  const uid = user?.id;
  const [colors, setColors] = useState(() => loadThemeCache(uid));
  const [backgrounds, setBackgrounds] = useState([]); // [{id,url}]
  const [savedThemes, setSavedThemes] = useState([]); // [{id,name,colors}]

  // Keep the latest colors in a ref so setters don't need to re-create.
  const colorsRef = useRef(colors);
  useEffect(() => { colorsRef.current = colors; }, [colors]);

  // Load cache instantly, then reconcile with the server (cross-device).
  useEffect(() => {
    // Auth's session restore is itself async — `uid` is briefly `undefined`
    // on a fresh load before it resolves to the real user, especially
    // noticeable on a hard refresh (slower bundle/network round trip gives
    // this window more time to actually paint). Treating that transient
    // window the same as "no user" wiped the background via
    // clearThemeColors() every time, then reapplied it a moment later —
    // visible as the background flashing away and back. Same bug class as
    // the pet-spin-on-refresh race in PetContext.js.
    if (authLoading) return undefined;
    if (!uid) { setColors({}); clearThemeColors(); return undefined; }
    let cancelled = false;
    const cached = loadThemeCache(uid);
    setColors(cached);
    applyThemeColors(cached);
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.theme_colors && typeof prefs.theme_colors === 'object') {
        setColors(prefs.theme_colors);
        applyThemeColors(prefs.theme_colors);
        saveThemeCache(uid, prefs.theme_colors);
        if (prefs.theme_colors.background) cacheBackgroundImage(prefs.theme_colors.background);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, authLoading]);

  // Load the user's saved backgrounds & themes.
  const refreshBackgrounds = useCallback(async () => {
    if (!uid) { setBackgrounds([]); return; }
    const { data } = await supabase.from('user_backgrounds')
      .select('id, url').eq('user_id', uid).order('created_at', { ascending: false });
    setBackgrounds(data || []);
  }, [uid]);

  const refreshThemes = useCallback(async () => {
    if (!uid) { setSavedThemes([]); return; }
    const { data } = await supabase.from('user_themes')
      .select('id, name, colors').eq('user_id', uid).order('created_at', { ascending: false });
    setSavedThemes(data || []);
  }, [uid]);

  useEffect(() => { refreshBackgrounds(); refreshThemes(); }, [refreshBackgrounds, refreshThemes]);

  // Re-apply when the light/dark base theme flips so derived shades recompute.
  useEffect(() => { applyThemeColors(colorsRef.current); }, [theme]);

  // `immediate` skips the debounce — used for discrete one-shot actions
  // (picking a background, resetting, applying a saved theme) where there's
  // no rapid-fire input to coalesce. Debouncing those risked losing the
  // write entirely if the user refreshed before the 600ms timer fired,
  // which made the local cache (applied instantly) and the server value
  // (still stale) diverge — the server value would then win on next load's
  // reconciliation fetch, silently reverting the background image.
  const commit = useCallback((next, immediate = false) => {
    setColors(next);
    applyThemeColors(next);
    saveThemeCache(uid, next);
    if (immediate) saveUserPrefs(uid, { theme_colors: next });
    else saveUserPrefsDebounced(uid, { theme_colors: next });
  }, [uid]);

  const setColor   = useCallback((key, value) => commit({ ...colorsRef.current, [key]: value }), [commit]);
  const resetColor = useCallback((key) => {
    const next = { ...colorsRef.current };
    delete next[key];
    commit(next, true);
  }, [commit]);
  const resetAll   = useCallback(() => commit({}, true), [commit]);

  const getColor = useCallback((key) => effectiveColor(key, colors), [colors]);
  const isCustom = useCallback((key) => Object.prototype.hasOwnProperty.call(colors, key), [colors]);

  // ── Background images ────────────────────────────────────
  const setBackground = useCallback((url) => {
    if (url) { commit({ ...colorsRef.current, background: url }, true); cacheBackgroundImage(url); }
    else { const next = { ...colorsRef.current }; delete next.background; commit(next, true); }
  }, [commit]);

  const uploadBackground = useCallback(async (file) => {
    if (!uid || !file) return;
    if (backgrounds.length >= MAX_BACKGROUNDS) throw new Error(`You can save up to ${MAX_BACKGROUNDS} backgrounds.`);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `backgrounds/${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('task-images').upload(path, file, { upsert: true });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('task-images').getPublicUrl(path);
    const url = data.publicUrl;
    const { error: insErr } = await supabase.from('user_backgrounds').insert({ user_id: uid, url });
    if (insErr) throw insErr;
    await refreshBackgrounds();
    return url;
  }, [uid, backgrounds.length, refreshBackgrounds]);

  const deleteBackground = useCallback(async (bg) => {
    if (!uid || !bg) return;
    await supabase.from('user_backgrounds').delete().eq('id', bg.id);
    // Keep the storage object AND the local data-URI cache so any theme still
    // referencing it keeps working on this device (until cache is cleared).
    await refreshBackgrounds();
  }, [uid, refreshBackgrounds]);

  const themesUsingBackground = useCallback(
    (url) => savedThemes.filter(t => t.colors && t.colors.background === url),
    [savedThemes]
  );

  // ── Saved themes ─────────────────────────────────────────
  const saveTheme = useCallback(async (name) => {
    if (!uid || !name.trim()) return;
    await supabase.from('user_themes').insert({ user_id: uid, name: name.trim(), colors: colorsRef.current });
    await refreshThemes();
  }, [uid, refreshThemes]);

  const applyTheme = useCallback((themeRec) => {
    const next = themeRec?.colors || {};
    commit(next, true);
    if (next.background) cacheBackgroundImage(next.background);
  }, [commit]);

  const deleteTheme = useCallback(async (id) => {
    if (!uid) return;
    await supabase.from('user_themes').delete().eq('id', id);
    await refreshThemes();
  }, [uid, refreshThemes]);

  return (
    <Ctx.Provider value={{
      colors, setColor, resetColor, resetAll, getColor, isCustom,
      backgrounds, maxBackgrounds: MAX_BACKGROUNDS, setBackground, uploadBackground, deleteBackground,
      savedThemes, saveTheme, applyTheme, deleteTheme, themesUsingBackground,
    }}>
      {children}
    </Ctx.Provider>
  );
}
