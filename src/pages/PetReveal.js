import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePets } from '../context/PetContext';
import PetSpinReveal from '../components/PetSpinReveal';
import './Auth.css';
import './PetReveal.css';

export default function PetReveal() {
  const navigate = useNavigate();
  const { pendingUnlocks, pets, claimNextPendingUnlock, loading, userGamificationEnabled } = usePets();
  const [result, setResult] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState('');
  const checkedRef = useRef(false);

  // Nothing to do here (already fully onboarded, or personally opted out —
  // this route is reachable directly by URL, not just via RequirePet's
  // redirect, so opting out has to be re-checked here too) — bounce to the
  // dashboard. Checked once at mount only, so it never fires mid-spin.
  useEffect(() => {
    if (loading || checkedRef.current) return;
    checkedRef.current = true;
    if (!userGamificationEnabled || (pendingUnlocks <= 0 && pets.length > 0)) navigate('/dashboard', { replace: true });
  }, [loading, pendingUnlocks, pets.length, userGamificationEnabled, navigate]);

  const handleSpin = async () => {
    setSpinning(true);
    setError('');
    try {
      const pet = await claimNextPendingUnlock();
      setResult(pet);
    } catch (err) {
      setError(err.message || 'Failed to spin');
    } finally {
      setSpinning(false);
    }
  };

  const handleDone = () => {
    setResult(null);
    if (pendingUnlocks <= 0) navigate('/dashboard', { replace: true });
  };

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-bg"><div className="auth-orb auth-orb-1" /><div className="auth-orb auth-orb-2" /></div>
        <div className="auth-card fade-in" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-card fade-in pet-reveal-card">
        {!result ? (
          <>
            <div className="auth-logo" style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎁</div>
              <h1>You've got a pet waiting!</h1>
              <p>Spin to reveal your new companion</p>
            </div>
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>⚠ {error}</div>}
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={handleSpin}
              disabled={spinning}
            >
              {spinning ? 'Spinning…' : 'Spin'}
            </button>
          </>
        ) : (
          <PetSpinReveal result={result} onDone={handleDone} />
        )}
      </div>
    </div>
  );
}
