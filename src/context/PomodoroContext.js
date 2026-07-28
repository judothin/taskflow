import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// A single app-wide Pomodoro timer so the dedicated page and the dashboard
// widget share one running clock — start it anywhere, it keeps ticking as you
// navigate. Custom focus/break durations persist in localStorage.
const KEY = 'tf-pomodoro-settings';
const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};

const clampMin = (n, fb) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= 180 ? v : fb;
};

const PomodoroContext = createContext(null);
export const usePomodoro = () => useContext(PomodoroContext);

export function PomodoroProvider({ children }) {
  const saved = loadSettings();
  const [focusMin, setFocusMinState] = useState(clampMin(saved.focusMin, 25));
  const [breakMin, setBreakMinState] = useState(clampMin(saved.breakMin, 5));
  const [mode, setMode] = useState('focus'); // 'focus' | 'break'
  const [secLeft, setSecLeft] = useState(clampMin(saved.focusMin, 25) * 60);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [justFinished, setJustFinished] = useState(false);

  const totalSec = (mode === 'break' ? breakMin : focusMin) * 60;

  // Persist the custom durations.
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ focusMin, breakMin })); } catch { /* non-fatal */ }
  }, [focusMin, breakMin]);

  // The ticking clock (lives here, so it runs no matter which page is mounted).
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setSecLeft(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Session finished → stop, count it (focus only), and flip to the other mode.
  useEffect(() => {
    if (!running || secLeft !== 0) return;
    const wasFocus = mode === 'focus';
    const next = wasFocus ? 'break' : 'focus';
    setRunning(false);
    if (wasFocus) setCompleted(c => c + 1);
    setMode(next);
    setSecLeft((next === 'break' ? breakMin : focusMin) * 60);
    setJustFinished(true);
  }, [running, secLeft, mode, breakMin, focusMin]);

  const toggle = useCallback(() => {
    setJustFinished(false);
    setSecLeft(s => (s === 0 ? (mode === 'break' ? breakMin : focusMin) * 60 : s));
    setRunning(r => !r);
  }, [mode, breakMin, focusMin]);

  const reset = useCallback(() => {
    setRunning(false);
    setJustFinished(false);
    setSecLeft((mode === 'break' ? breakMin : focusMin) * 60);
  }, [mode, breakMin, focusMin]);

  const switchTo = useCallback((m) => {
    setMode(m);
    setRunning(false);
    setJustFinished(false);
    setSecLeft((m === 'break' ? breakMin : focusMin) * 60);
  }, [breakMin, focusMin]);

  const setFocusMin = useCallback((n) => {
    const v = clampMin(n, focusMin);
    setFocusMinState(v);
    if (mode === 'focus' && !running) setSecLeft(v * 60);
  }, [mode, running, focusMin]);

  const setBreakMin = useCallback((n) => {
    const v = clampMin(n, breakMin);
    setBreakMinState(v);
    if (mode === 'break' && !running) setSecLeft(v * 60);
  }, [mode, running, breakMin]);

  const value = {
    focusMin, breakMin, mode, secLeft, running, completed, totalSec, justFinished,
    toggle, reset, switchTo, setFocusMin, setBreakMin,
  };

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}
