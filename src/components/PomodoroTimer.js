import React from 'react';
import { usePomodoro } from '../context/PomodoroContext';
import './PomodoroTimer.css';

const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
const FOCUS_PRESETS = [15, 25, 45, 60];

// Shared Pomodoro UI, driven by the app-wide PomodoroContext. `compact` renders
// the smaller dashboard-widget variant.
export default function PomodoroTimer({ compact = false }) {
  const {
    focusMin, breakMin, mode, secLeft, running, completed, totalSec, justFinished,
    toggle, reset, switchTo, setFocusMin, setBreakMin,
  } = usePomodoro();

  const R = compact ? 66 : 130;
  const size = compact ? 150 : 300;
  const C = 2 * Math.PI * R;
  const frac = totalSec ? secLeft / totalSec : 0;
  const offset = C * (1 - frac);
  const isBreak = mode === 'break';

  const Stepper = ({ label, value, onChange }) => (
    <div className="pomo-stepper">
      <span className="pomo-stepper-label">{label}</span>
      <div className="pomo-stepper-control">
        <button type="button" onClick={() => onChange(value - 5)} disabled={running} aria-label={`Decrease ${label}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <input
          type="number" min="1" max="180" value={value} disabled={running}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" onClick={() => onChange(value + 5)} disabled={running} aria-label={`Increase ${label}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>
      <span className="pomo-stepper-unit">min</span>
    </div>
  );

  return (
    <div className={`pomo ${compact ? 'pomo-compact' : ''}`}>
      {/* Mode toggle */}
      <div className="pomo-modes">
        <button className={`pomo-mode ${!isBreak ? 'pomo-mode-active' : ''}`} onClick={() => switchTo('focus')}>Focus</button>
        <button className={`pomo-mode ${isBreak ? 'pomo-mode-active' : ''}`} onClick={() => switchTo('break')}>Break</button>
      </div>

      {/* Ring */}
      <div className={`pomo-ring-wrap ${isBreak ? 'pomo-break' : ''} ${justFinished ? 'pomo-done' : ''}`} style={{ width: size, height: size }}>
        <svg className="pomo-ring" viewBox="0 0 300 300" style={{ width: size, height: size }}>
          <circle cx="150" cy="150" r={R} className="pomo-ring-track" />
          <circle
            cx="150" cy="150" r={R}
            className="pomo-ring-progress"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform="rotate(-90 150 150)"
          />
        </svg>
        <div className="pomo-ring-center">
          <span className="pomo-time">{fmt(secLeft)}</span>
          <span className="pomo-label">
            {justFinished ? 'Done!' : running ? (isBreak ? 'On break' : 'Focusing') : isBreak ? 'Break' : 'Ready'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="pomo-controls">
        <button className="btn btn-primary pomo-btn" onClick={toggle}>
          {running ? (
            <><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> Pause</>
          ) : (
            <><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> {secLeft === 0 ? 'Restart' : 'Start'}</>
          )}
        </button>
        <button className="btn btn-ghost pomo-btn" onClick={reset} title="Reset">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8" /><path d="M3 3v5h5" /></svg>
          {!compact && 'Reset'}
        </button>
      </div>

      {/* Focus presets (quick pick) */}
      {!isBreak && (
        <div className="pomo-presets">
          {FOCUS_PRESETS.map(m => (
            <button
              key={m}
              className={`pomo-preset ${focusMin === m ? 'pomo-preset-active' : ''}`}
              onClick={() => setFocusMin(m)}
              disabled={running}
            >
              {m}m
            </button>
          ))}
        </div>
      )}

      {/* Custom durations */}
      <div className="pomo-custom">
        <Stepper label="Focus" value={focusMin} onChange={setFocusMin} />
        <Stepper label="Break" value={breakMin} onChange={setBreakMin} />
      </div>

      <div className="pomo-count">
        <span className="pomo-count-dot" />
        {completed} pomodoro{completed !== 1 ? 's' : ''} completed
      </div>
    </div>
  );
}
