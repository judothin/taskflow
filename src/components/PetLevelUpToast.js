import React, { useEffect } from 'react';
import { usePets } from '../context/PetContext';
import './PetToast.css';

export default function PetLevelUpToast({ levelsGained, onDone }) {
  const { userLevel } = usePets();

  useEffect(() => {
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div className="pet-toast fade-in" role="status" onClick={onDone}>
      <span className="pet-toast-icon">⭐</span>
      <div>
        <div className="pet-toast-title">Level up!</div>
        <div className="pet-toast-sub">
          {levelsGained > 1 ? `+${levelsGained} levels — ` : ''}
          You're now level {userLevel?.level ?? '?'}
        </div>
      </div>
    </div>
  );
}
