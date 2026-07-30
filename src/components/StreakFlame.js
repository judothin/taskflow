import React from 'react';
import { streakTier, streakImg } from '../lib/streak';
import './StreakFlame.css';

// The top-bar streak flame. Its art + glow colour step up with the streak
// length; once it hits the final (pearl) tier the glow grows a little bigger
// and brighter each additional day. `teamId` is the key so switching teams
// crossfades to that team's flame. The day count sits over the flame.
export default function StreakFlame({ days, paused, teamId, size = 34 }) {
  const tier = streakTier(days);
  if (!tier) return null;

  const isPearl = tier.key === 'pearl';
  const bonus = isPearl ? Math.min(days - 22, 30) : 0; // escalate past the final tier
  const glowSize = 6 + (isPearl ? bonus * 0.5 : 0);

  return (
    <div
      key={teamId}
      className={`streak-flame ${paused ? 'streak-flame-paused' : ''}`}
      style={{
        '--flame-size': `${size}px`,
        '--glow': tier.glow,
        '--glow2': tier.glow2 || tier.glow,
        '--glow-blur': `${glowSize}px`,
        '--count-top': `${tier.countTop}%`,
      }}
      title={`${days}-day streak — ${tier.label}${paused ? ' (paused)' : ''}`}
    >
      <img className="streak-flame-img" src={streakImg(tier.key)} alt="" draggable={false} />
      <span className="streak-flame-count" style={{ '--count-glow': tier.glow }}>{days}</span>
      {paused && <span className="streak-flame-pause" aria-hidden="true">⏸</span>}
    </div>
  );
}
