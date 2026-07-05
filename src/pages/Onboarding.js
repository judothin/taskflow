import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import TeamJoinCreateForm from '../components/TeamJoinCreateForm';
import './Auth.css';

export default function Onboarding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { refreshTeams, switchTeam } = useTeam();
  const { refresh: refreshPets } = usePets();

  const handleDone = async (team) => {
    await refreshTeams();
    // Belt-and-suspenders alongside the same refresh in Register.js — makes
    // sure RequireGamificationChoice has real data the moment we land on
    // /dashboard, not a stale pre-signup-insert cache.
    await refreshPets();
    switchTeam(team.id);
    navigate('/dashboard');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-card fade-in" style={{ maxWidth: 440 }}>
        <div className="auth-logo">
          <img src="/logo.png" alt="TaskFlow" style={{ margin: '0 auto 16px', width: 44, height: 44, borderRadius: 8, objectFit: 'contain', display: 'block' }} />
          <h1>One more step</h1>
          <p>Create a team, or join one with an invite code</p>
        </div>

        <TeamJoinCreateForm defaultCode={params.get('invite') || ''} onDone={handleDone} />

        <div className="auth-footer">
          <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
