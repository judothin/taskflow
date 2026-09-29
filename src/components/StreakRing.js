import React, { useId } from 'react';
import { streakTier } from '../lib/streak';
import './StreakRing.css';

// The phone header's streak badge: the day count inside a thin ring in the
// tier's colours (see STREAK_TIERS). The phone header has room for a round
// badge, not a bar — desktop and the cards use StreakBar instead.
//
// Renders nothing with no streak; the header shows the logo in that case.
// Callers key it by team so switching teams animates in that team's ring.
export default function StreakRing({ days, paused, size = 30 }) {
  const gradId = `streak-grad-${useId().replace(/:/g, '')}`;
  const tier = streakTier(days);
  if (!tier) return null;

  // Thin enough to read as a ring, not a donut.
  const stroke = Math.max(1.75, size * 0.055);
  const r = (size - stroke) / 2;
  const title = `${days}-day streak — ${tier.label}${paused ? ' (paused)' : ''}`;

  return (
    <div
      className={`streak-ring ${paused ? 'streak-ring-paused' : ''}`}
      style={{
        '--ring-size': `${size}px`,
        '--glow': tier.c1,
        '--glow2': tier.c2,
        '--glow-blur': `${(size * 0.09).toFixed(1)}px`,
        '--count-size': `${Math.round(size * (days >= 100 ? 0.3 : 0.36))}px`,
      }}
      title={title}
      role="img"
      aria-label={title}
    >
      <svg className="streak-ring-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tier.c1} />
            <stop offset="100%" stopColor={tier.c2} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gradId})`} strokeWidth={stroke} />
      </svg>
      <span className="streak-ring-count">{days}</span>
      {paused && <span className="streak-ring-pause" aria-hidden="true" />}
    </div>
  );
}
