import React, { useEffect, useState } from 'react';
import './LevelBar.css';

// A level/XP progress bar that also shows a transient "+N XP" pop above the
// track. Pass a new `popKey` (e.g. an incrementing counter) each time XP is
// gained to trigger a pop — `popAmount` is the value shown.
export default function LevelBar({ label, level, xp, xpToNext, color, popKey, popAmount }) {
  const [pops, setPops] = useState([]);

  useEffect(() => {
    if (popKey == null) return undefined;
    const id = popKey;
    setPops(p => [...p, { id, amount: popAmount }]);
    const t = setTimeout(() => setPops(p => p.filter(x => x.id !== id)), 1300);
    return () => clearTimeout(t);
  }, [popKey, popAmount]);

  const pct = Math.max(0, Math.min(100, (xp / Math.max(1, xpToNext)) * 100));

  return (
    <div className="level-bar-row">
      <div className="level-bar-top">
        <span className="level-bar-label">{label}</span>
        <span className="level-bar-lv">Lv {level}</span>
      </div>
      <div className="level-bar-track">
        <div className="level-bar-fill" style={{ width: `${pct}%`, background: color }} />
        {pops.map(p => (
          <span key={p.id} className="level-bar-pop">+{p.amount} XP</span>
        ))}
      </div>
    </div>
  );
}
