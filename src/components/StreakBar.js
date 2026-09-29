import React, { useId } from 'react';
import { streakTier } from '../lib/streak';
import './StreakBar.css';

// ══════════════════════════════════════════════════════════════
// Streak bar
// --------------------------------------------------------------
// Your current streak as progress toward your best one. Below your best the
// bar fills in the tier's colours (bronze → silver → blaze → teal → aurora,
// see STREAK_TIERS). Once you've caught your best, every day you keep going
// IS the new best: the bar stays full, takes a new colour each day, and a
// flame writhes beside the number for as long as the record run lasts.
//
// `variant`:
//   compact — one line (flame, number, bar) for the header / top bar
//   full    — the number, the bar and what it means, for cards
// ══════════════════════════════════════════════════════════════

// A colour pair unique to each day of a record run. The step is coprime-ish
// with 360 so consecutive days land far apart on the wheel, not next door.
function recordColors(days) {
  const h = (days * 47 + 200) % 360;
  return {
    c1: `hsl(${h} 90% 56%)`,
    c2: `hsl(${(h + 48) % 360} 95% 62%)`,
  };
}

export function streakState(days, best) {
  const d = Math.max(0, days || 0);
  // The stored best can briefly trail the current count (it's updated by the
  // same write) — never show more than a full bar or a "negative" gap.
  const b = Math.max(d, best || 0);
  const onRecord = d > 0 && d >= b;
  const tier = streakTier(d);
  const colors = onRecord ? recordColors(d) : tier ? { c1: tier.c1, c2: tier.c2 } : null;
  return { days: d, best: b, onRecord, tier, colors, pct: b ? d / b : 0 };
}

// Two tongues of flame, animated independently (StreakBar.css) so it moves
// like fire rather than one shape wobbling. Coloured from the day's pair.
export function WrithingFlame({ c1, c2, size = 16 }) {
  const id = `flame-${useId().replace(/:/g, '')}`;
  return (
    <svg className="sb-flame" width={size * 0.8} height={size} viewBox="0 0 24 30" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-o`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
        <linearGradient id={`${id}-i`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="100%" stopColor={c2} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path
        className="sb-flame-outer"
        fill={`url(#${id}-o)`}
        d="M12 1c1.2 5.2 7.5 8.4 7.5 16.2A7.5 7.5 0 0 1 4.5 17.2c0-4.3 2.4-6.6 3.9-10 .9 2.7 2 4 3.2 4.8C11.9 8.6 11.4 4.8 12 1z"
      />
      <path
        className="sb-flame-inner"
        fill={`url(#${id}-i)`}
        d="M12.2 12.5c.7 2.9 4 4.6 4 8.4a4.2 4.2 0 0 1-8.4 0c0-2.4 1.4-3.8 2.2-5.6.5 1.2 1.1 1.9 1.8 2.3.3-1.6.1-3.2.4-5.1z"
      />
    </svg>
  );
}

export default function StreakBar({ days, best, paused, variant = 'compact' }) {
  const s = streakState(days, best);
  if (!s.colors) return null;

  const title = s.onRecord
    ? `${s.days}-day streak — your best ever${paused ? ' (paused)' : ''}`
    : `${s.days}-day streak — best is ${s.best}${paused ? ' (paused)' : ''}`;

  const style = {
    '--sb-c1': s.colors.c1,
    '--sb-c2': s.colors.c2,
    '--sb-pct': `${Math.max(6, s.pct * 100)}%`,
  };
  const cls = `sb sb-${variant} ${s.onRecord ? 'sb-record' : ''} ${paused ? 'sb-paused' : ''}`;

  const bar = (
    <span className="sb-track" aria-hidden="true">
      <span className="sb-fill" />
    </span>
  );

  if (variant === 'compact') {
    return (
      <div className={cls} style={style} title={title} role="img" aria-label={title}>
        {s.onRecord && <WrithingFlame c1={s.colors.c1} c2={s.colors.c2} size={16} />}
        <span className="sb-num">{s.days}</span>
        {bar}
      </div>
    );
  }

  const toGo = s.best - s.days;
  return (
    <div className={cls} style={style}>
      <div className="sb-head">
        {s.onRecord && <WrithingFlame c1={s.colors.c1} c2={s.colors.c2} size={26} />}
        <span className="sb-big">{s.days}</span>
        <span className="sb-unit">day{s.days === 1 ? '' : 's'}</span>
        {paused && <span className="sb-tag sb-tag-paused">Paused</span>}
        {s.onRecord && !paused && <span className="sb-tag sb-tag-record">Personal best</span>}
      </div>
      {bar}
      <div className="sb-caption">
        {s.onRecord
          ? 'New record — every day you keep going adds to it.'
          : `${toGo} day${toGo === 1 ? '' : 's'} to beat your best of ${s.best}`}
      </div>
    </div>
  );
}
