import React, { useEffect, useState } from 'react';
import { usePets } from '../context/PetContext';
import { userXpToNext } from '../lib/xp';
import './LevelRing.css';

// The level readout, in the phone header and the desktop top bar alike: the
// level number inside a ring that fills with XP toward the next one. Pulses
// when XP lands (the `xp-awarded` event).
export default function LevelRing({ size = 36, stroke = 3.5 }) {
  const { userLevel } = usePets();
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    let t;
    const handler = (e) => {
      if (!e.detail?.userXpGained) return;
      setPulsing(true);
      clearTimeout(t);
      t = setTimeout(() => setPulsing(false), 520);
    };
    window.addEventListener('xp-awarded', handler);
    return () => { clearTimeout(t); window.removeEventListener('xp-awarded', handler); };
  }, []);

  const level = userLevel?.level || 1;
  const xp = userLevel?.xp || 0;
  const xpToNext = userXpToNext(level);
  const pct = Math.max(0, Math.min(1, xp / Math.max(1, xpToNext)));

  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div
      className={`level-ring ${pulsing ? 'level-ring-pulse' : ''}`}
      style={{ width: size, height: size }}
      title={`Level ${level} — ${Math.round(xp)}/${xpToNext} XP`}
      role="img"
      aria-label={`Level ${level}, ${Math.round(pct * 100)}% to level ${level + 1}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="level-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="level-ring-fill"
          cx={size / 2} cy={size / 2} r={r}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
        />
      </svg>
      <span className="level-ring-num">{level}</span>
    </div>
  );
}
