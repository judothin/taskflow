import React from 'react';
import { Link } from 'react-router-dom';
import { WidgetHead } from './dashboardWidgets';
import { usePomodoro } from '../context/PomodoroContext';
import './PomodoroWidget.css';

const ICON = 'M12 8v4l3 2 M12 2a10 10 0 100 20 10 10 0 000-20z M9 2h6';
const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

function Stepper({ label, value, onChange, disabled }) {
  return (
    <div className="pw-step">
      <span className="pw-step-label">{label}</span>
      <div className="pw-step-ctrl">
        <button type="button" onClick={() => onChange(value - 5)} disabled={disabled} aria-label={`Decrease ${label}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
        <input type="number" min="1" max="180" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange(value + 5)} disabled={disabled} aria-label={`Increase ${label}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>
    </div>
  );
}

// Dashboard widget: a horizontal Pomodoro card — ring on the left, controls +
// custom durations on the right. Shares the app-wide PomodoroContext.
export default function PomodoroWidget() {
  const {
    focusMin, breakMin, mode, secLeft, running, completed, totalSec, justFinished,
    toggle, reset, switchTo, setFocusMin, setBreakMin,
  } = usePomodoro();

  const isBreak = mode === 'break';
  const R = 54;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - (totalSec ? secLeft / totalSec : 0));

  return (
    <>
      <WidgetHead
        icon={ICON}
        title="Pomodoro"
        action={<Link to="/pomodoro" className="pw-open">Open</Link>}
      />

      <div className="pw">
        {/* Mode toggle — above the timer */}
        <div className="pw-modes">
          <button className={!isBreak ? 'pw-mode-on' : ''} onClick={() => switchTo('focus')}>Focus</button>
          <button className={isBreak ? 'pw-mode-on' : ''} onClick={() => switchTo('break')}>Break</button>
        </div>

        {/* Ring */}
        <div className={`pw-ring ${isBreak ? 'pw-break' : ''} ${justFinished ? 'pw-done' : ''}`}>
          <svg viewBox="0 0 130 130">
            <circle cx="65" cy="65" r={R} className="pw-ring-track" />
            <circle cx="65" cy="65" r={R} className="pw-ring-prog" strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 65 65)" />
          </svg>
          <div className="pw-ring-c">
            <span className="pw-time">{fmt(secLeft)}</span>
            <span className="pw-state">{justFinished ? 'Done!' : running ? (isBreak ? 'Break' : 'Focus') : 'Ready'}</span>
          </div>
        </div>

        {/* Controls + settings */}
        <div className="pw-side">
          <div className="pw-controls">
            <button className="btn btn-primary pw-start" onClick={toggle}>
              {running ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> Pause</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg> {secLeft === 0 ? 'Restart' : 'Start'}</>
              )}
            </button>
            <button className="btn btn-ghost pw-reset" onClick={reset} aria-label="Reset" title="Reset">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          </div>

          <div className="pw-steppers">
            <Stepper label="Focus" value={focusMin} onChange={setFocusMin} disabled={running} />
            <Stepper label="Break" value={breakMin} onChange={setBreakMin} disabled={running} />
          </div>

          <div className="pw-count"><span className="pw-count-dot" />{completed} completed</div>
        </div>
      </div>
    </>
  );
}
