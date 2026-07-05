import React, { useEffect, useState } from 'react';
import { usePets } from '../context/PetContext';
import { userXpToNext } from '../lib/xp';
import './UserXpBar.css';

// Small always-visible pill showing the user's own level/XP — lives on the
// dashboard top bar (alongside the clock / New Task etc.) rather than inside
// the pet widget, since it's a user-level stat, not a pet one.
export default function UserXpBar() {
  const { userLevel } = usePets();
  const [pops, setPops] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      if (!d.userXpGained) return;
      const id = Date.now() + Math.random();
      setPops(p => [...p, { id, amount: d.userXpGained }]);
      setTimeout(() => setPops(p => p.filter(x => x.id !== id)), 1300);
    };
    window.addEventListener('xp-awarded', handler);
    return () => window.removeEventListener('xp-awarded', handler);
  }, []);

  const level = userLevel?.level || 1;
  const xp = userLevel?.xp || 0;
  const xpToNext = userXpToNext(level);
  const pct = Math.max(0, Math.min(100, (xp / Math.max(1, xpToNext)) * 100));

  return (
    <div className="user-xp-pill" title={`Level ${level} — ${Math.round(xp)}/${xpToNext} XP`}>
      <span className="user-xp-lv">Lv {level}</span>
      <div className="user-xp-track">
        <div className="user-xp-fill" style={{ width: `${pct}%` }} />
        {pops.map(p => (
          <span key={p.id} className="user-xp-pop">+{p.amount} XP</span>
        ))}
      </div>
    </div>
  );
}
