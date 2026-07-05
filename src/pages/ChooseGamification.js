import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePets } from '../context/PetContext';
import './Auth.css';

// Shown once per user — new signups land here right after team setup, and
// existing users who've never gotten a pet get sent here too (see the
// gamification migration's backfill + RequireGamificationChoice in App.js).
// After this, `gamification_choice_made` is permanently true and this page
// is never shown again; the choice itself stays changeable later from
// Settings.
export default function ChooseGamification() {
  const navigate = useNavigate();
  const { setGamificationEnabled } = usePets();
  const [saving, setSaving] = useState(false);

  const choose = async (enabled) => {
    setSaving(true);
    try {
      await setGamificationEnabled(enabled);
      // If enabled, RequirePet will catch the pending unlock this just
      // granted and redirect to /pet-reveal on its own — same as a normal
      // signup landing on /dashboard for the first time.
      navigate('/dashboard');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-card fade-in" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div className="auth-logo">
          <div style={{ fontSize: 40, marginBottom: 10 }}>🐾</div>
          <h1>Pets &amp; levels</h1>
          <p>
            Complete tasks to level up and unlock a pet that grows alongside you.
            Totally optional — you can turn it on or off any time from Settings.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => choose(true)}
            disabled={saving}
          >
            {saving ? 'Saving…' : "Yes, I'm in!"}
          </button>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => choose(false)}
            disabled={saving}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
