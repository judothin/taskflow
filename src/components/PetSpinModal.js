import React, { useEffect, useState } from 'react';
import { usePets } from '../context/PetContext';
import ModalPortal from './ModalPortal';
import PetSpinReveal from './PetSpinReveal';

// Shown whenever a level milestone grants a new pet mid-session. Claims the
// unlock immediately (so the true result is known before the reel even
// starts moving) then hands off to the shared spin/reveal animation.
export default function PetSpinModal({ onClose }) {
  const { claimNextPendingUnlock } = usePets();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    claimNextPendingUnlock()
      .then(pet => { if (!cancelled) setResult(pet); })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to claim your new pet'); });
    return () => { cancelled = true; };
  }, [claimNextPendingUnlock]);

  return (
    <ModalPortal>
    <div className="modal-overlay" style={{ zIndex: 3000 }}>
      <div className="modal pet-spin-modal">
        <div className="modal-header">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>New pet unlocked!</h2>
        </div>
        <div className="modal-body">
          {error ? (
            <div className="error-msg">⚠ {error}</div>
          ) : !result ? (
            <div className="pet-spin-loading">Rolling…</div>
          ) : (
            <PetSpinReveal result={result} onDone={onClose} />
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
