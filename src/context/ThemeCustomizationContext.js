import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { supabase } from '../lib/supabase';
import {
  applyThemeColors, clearThemeColors, effectiveColor, loadThemeCache, saveThemeCache,
  cacheBackgroundImage, resolveForDevice,
} from '../lib/themeColors';
import useIsPhone from '../lib/useIsPhone';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';

const MAX_BACKGROUNDS = 10;

const Ctx = createContext({});
export const useThemeCustomization = () => useContext(Ctx);

export function ThemeCustomizationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { theme } = useTheme();
  const uid = user?.id;
  const isPhone = useIsPhone();
  const [colors, setColors] = useState(() => loadThemeCache(uid));
  const [backgrounds, setBackgrounds] = useState([]); // [{id,url}]
  const [savedThemes, setSavedThemes] = useState([]); // [{id,name,colors}]

  // Keep the latest colors in a ref so setters don't need to re-create.
  const colorsRef = useRef(colors);
  useEffect(() => { colorsRef.current = colors; }, [colors]);
  const isPhoneRef = useRef(isPhone);
  useEffect(() => { isPhoneRef.current = isPhone; }, [isPhone]);

  // What this device actually shows: desktop values, with the phone's own
  // overrides on top when it's a phone (see resolveForDevice).
  const apply = useCallback((all) => {
    const eff = resolveForDevice(all, isPhoneRef.current);
    applyThemeColors(eff);
    return eff;
  }, []);

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
    apply(cached);
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.theme_colors && typeof prefs.theme_colors === 'object') {
        setColors(prefs.theme_colors);
        const eff = apply(prefs.theme_colors);
        saveThemeCache(uid, prefs.theme_colors);
        if (eff.background) cacheBackgroundImage(eff.background);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, authLoading, apply]);

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

  // Re-apply when the light/dark base theme flips so derived shades recompute,
  // and when the viewport crosses the phone breakpoint so the right set of
  // overrides is showing.
  useEffect(() => {
    const eff = apply(colorsRef.current);
    if (eff.background) cacheBackgroundImage(eff.background);
  }, [theme, isPhone, apply]);

  // `immediate` skips the debounce — used for discrete one-shot actions
  // (picking a background, resetting, applying a saved theme) where there's
  // no rapid-fire input to coalesce. Debouncing those risked losing the
  // write entirely if the user refreshed before the 600ms timer fired,
  // which made the local cache (applied instantly) and the server value
  // (still stale) diverge — the server value would then win on next load's
  // reconciliation fetch, silently reverting the background image.
  const commit = useCallback((next, immediate = false) => {
    colorsRef.current = next; // a second call before the re-render builds on this one
    setColors(next);
    apply(next);
    saveThemeCache(uid, next);
    if (immediate) saveUserPrefs(uid, { theme_colors: next });
    else saveUserPrefsDebounced(uid, { theme_colors: next });
  }, [uid, apply]);

  const setColor   = useCallback((key, value) => commit({ ...colorsRef.current, [key]: value }), [commit]);
  // Several keys at once. Two back-to-back setColor() calls would both read the
  // same (pre-render) colorsRef, so the second would drop the first's change.
  const setColorValues = useCallback((patch) => commit({ ...colorsRef.current, ...patch }), [commit]);
  const resetColor = useCallback((key) => {
    const next = { ...colorsRef.current };
    delete next[key];
    commit(next, true);
  }, [commit]);
  // Desktop's reset leaves the phone's own overrides alone — they have their
  // own reset (resetMobileAll).
  const resetAll   = useCallback(() => {
    const { mobile } = colorsRef.current;
    commit(mobile ? { mobile } : {}, true);
  }, [commit]);

  const getColor = useCallback((key) => effectiveColor(key, colors), [colors]);
  const isCustom = useCallback((key) => Object.prototype.hasOwnProperty.call(colors, key), [colors]);

  // ── Phone-only overrides ─────────────────────────────────
  // Edited from the mobile Appearance screen. A null in `patch` means "unset
  // on the phone even though desktop sets it".
  const mobileColors = useMemo(
    () => ((colors.mobile && typeof colors.mobile === 'object') ? colors.mobile : {}), [colors]);
  const phoneColors = useMemo(() => resolveForDevice(colors, true), [colors]);
  // What's showing on this device right now.
  const activeColors = useMemo(() => resolveForDevice(colors, isPhone), [colors, isPhone]);
  const setMobileValues = useCallback((patch, immediate = false) => {
    const cur = colorsRef.current;
    commit({ ...cur, mobile: { ...(cur.mobile || {}), ...patch } }, immediate);
  }, [commit]);
  const resetMobileKey = useCallback((...keys) => {
    const cur = colorsRef.current;
    const mobile = { ...(cur.mobile || {}) };
    keys.forEach(k => delete mobile[k]);
    const next = { ...cur, mobile };
    if (!Object.keys(mobile).length) delete next.mobile;
    commit(next, true);
  }, [commit]);
  const resetMobileAll = useCallback(() => {
    const { mobile, ...rest } = colorsRef.current;
    commit(rest, true);
  }, [commit]);
  const getPhoneColor = useCallback((key) => effectiveColor(key, phoneColors), [phoneColors]);
  const isMobileCustom = useCallback(
    (key) => Object.prototype.hasOwnProperty.call(mobileColors, key), [mobileColors]);

  // ── Background images ────────────────────────────────────
  const setBackground = useCallback((url) => {
    if (url) {
      commit({ ...colorsRef.current, background: url }, true);
      // The image cache holds one background — only fill it with one this
      // device will actually show (a phone may have its own).
      if (resolveForDevice(colorsRef.current, isPhoneRef.current).background === url) cacheBackgroundImage(url);
    }
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
    // A saved theme is one look; the phone's overrides aren't part of it.
    const { mobile, ...themeColors } = colorsRef.current;
    await supabase.from('user_themes').insert({ user_id: uid, name: name.trim(), colors: themeColors });
    await refreshThemes();
  }, [uid, refreshThemes]);

  const applyTheme = useCallback((themeRec) => {
    const { mobile: _ignored, ...themeColors } = themeRec?.colors || {};
    const { mobile } = colorsRef.current;
    const next = mobile ? { ...themeColors, mobile } : themeColors;
    commit(next, true);
    const eff = resolveForDevice(next, isPhoneRef.current);
    if (eff.background) cacheBackgroundImage(eff.background);
  }, [commit]);

  // Apply a saved theme to the phone only. Every key the theme sets becomes a
  // phone override, and every desktop key it doesn't set is unset on the
  // phone, so the phone ends up looking exactly like the theme.
  const applyThemeToMobile = useCallback((themeRec) => {
    const { mobile: _ignored, ...themeColors } = themeRec?.colors || {};
    const { mobile: _old, ...base } = colorsRef.current;
    const mobile = { ...themeColors };
    Object.keys(base).forEach(k => { if (!(k in mobile)) mobile[k] = null; });
    commit({ ...base, mobile }, true);
    if (themeColors.background && isPhoneRef.current) cacheBackgroundImage(themeColors.background);
  }, [commit]);

  const deleteTheme = useCallback(async (id) => {
    if (!uid) return;
    await supabase.from('user_themes').delete().eq('id', id);
    await refreshThemes();
  }, [uid, refreshThemes]);

  return (
    <Ctx.Provider value={{
      colors, setColor, setColorValues, resetColor, resetAll, getColor, isCustom,
      backgrounds, maxBackgrounds: MAX_BACKGROUNDS, setBackground, uploadBackground, deleteBackground,
      savedThemes, saveTheme, applyTheme, deleteTheme, themesUsingBackground,
      activeColors, mobileColors, phoneColors, setMobileValues, resetMobileKey, resetMobileAll,
      getPhoneColor, isMobileCustom, applyThemeToMobile,
    }}>
      {children}
    </Ctx.Provider>
  );
}
