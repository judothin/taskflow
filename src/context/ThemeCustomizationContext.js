import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useTheme, normalizeMode } from './ThemeContext';
import { supabase } from '../lib/supabase';
import {
  applyThemeColors, clearThemeColors, loadThemeCache, saveThemeCache,
  cacheBackgroundImage, clearBgCache,
} from '../lib/themeColors';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';

const MAX_BACKGROUNDS = 10;

const Ctx = createContext({});
export const useThemeCustomization = () => useContext(Ctx);

// Keys that belong to the old classic / "new UI" looks. Dropped on load so
// a stale value can't recolour anything.
const LEGACY_KEYS = ['bg', 'text', 'border', 'logo', 'critical', 'open', 'in_progress', 'on_hold', 'completed', 'modernUi', 'preset', 'mobile'];
const clean = (c) => {
  const out = { ...(c || {}) };
  LEGACY_KEYS.forEach(k => delete out[k]);
  return out;
};

export function ThemeCustomizationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { mode, setMode } = useTheme();
  const uid = user?.id;
  const [colors, setColors] = useState(() => clean(loadThemeCache(uid)));
  const [backgrounds, setBackgrounds] = useState([]);
  const colorsRef = useRef(colors);
  useEffect(() => { colorsRef.current = colors; }, [colors]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!uid) { setColors({}); clearThemeColors(); return undefined; }
    let cancelled = false;
    const cached = clean(loadThemeCache(uid));
    setColors(cached);
    applyThemeColors(cached);
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.theme_colors && typeof prefs.theme_colors === 'object') {
        const remote = clean(prefs.theme_colors);
        setColors(remote);
        applyThemeColors(remote);
        saveThemeCache(uid, remote);
        if (remote.mode) setMode(normalizeMode(remote.mode));
        if (remote.background) cacheBackgroundImage(remote.background);
      }
    })();
    return () => { cancelled = true; };
  }, [uid, authLoading, setMode]);

  const refreshBackgrounds = useCallback(async () => {
    if (!uid) { setBackgrounds([]); return; }
    const { data } = await supabase.from('user_backgrounds')
      .select('id, url').eq('user_id', uid).order('created_at', { ascending: false });
    setBackgrounds(data || []);
  }, [uid]);
  useEffect(() => { refreshBackgrounds(); }, [refreshBackgrounds]);

  const commit = useCallback((next, immediate = false) => {
    colorsRef.current = next;
    setColors(next);
    applyThemeColors(next);
    saveThemeCache(uid, next);
    if (immediate) saveUserPrefs(uid, { theme_colors: next });
    else saveUserPrefsDebounced(uid, { theme_colors: next });
  }, [uid]);

  const setColor = useCallback((key, value) => commit({ ...colorsRef.current, [key]: value }), [commit]);
  const setColorValues = useCallback((patch, immediate) => commit({ ...colorsRef.current, ...patch }, immediate), [commit]);
  const resetColor = useCallback((key) => {
    const next = { ...colorsRef.current };
    delete next[key];
    commit(next, true);
  }, [commit]);

  const setAccent = useCallback((hex) => {
    const next = { ...colorsRef.current };
    if (hex) next.accent = hex; else delete next.accent;
    commit(next, true);
  }, [commit]);

  const setThemeMode = useCallback((m) => {
    setMode(m);
    commit({ ...colorsRef.current, mode: normalizeMode(m) }, true);
  }, [commit, setMode]);

  // ── Background images ──
  const setBackground = useCallback((url) => {
    const next = { ...colorsRef.current };
    if (url) { next.background = url; cacheBackgroundImage(url); } else delete next.background;
    commit(next, true);
  }, [commit]);

  const uploadBackground = useCallback(async (file) => {
    if (!uid || !file) return null;
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
    const url = bg.url;
    const { error } = await supabase.from('user_backgrounds').delete().eq('id', bg.id);
    if (error) throw error;
    const marker = '/object/public/task-images/';
    const at = url.indexOf(marker);
    if (at !== -1) {
      const { data: others } = await supabase.from('user_backgrounds')
        .select('id').eq('user_id', uid).eq('url', url).limit(1);
      if (!others || !others.length) {
        const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
        await supabase.storage.from('task-images').remove([path]);
      }
    }
    if (colorsRef.current.background === url) {
      const next = { ...colorsRef.current };
      delete next.background;
      commit(next, true);
    }
    clearBgCache(url);
    await refreshBackgrounds();
  }, [uid, commit, refreshBackgrounds]);

  return (
    <Ctx.Provider value={{
      colors, activeColors: colors, setColor, setColorValues, resetColor,
      accent: colors.accent || '', setAccent,
      mode, setThemeMode,
      backgrounds, maxBackgrounds: MAX_BACKGROUNDS, setBackground, uploadBackground, deleteBackground,
    }}>
      {children}
    </Ctx.Provider>
  );
}
