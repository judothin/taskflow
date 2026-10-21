import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import TeamJoinCreateForm from '../components/TeamJoinCreateForm';
import './Auth.css';

// After sign-up (or for anyone with no team): create one, or join with a code.
export default function Onboarding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { refreshTeams, switchTeam } = useTeam();
  const { refresh: refreshLevels } = usePets();
  const invite = params.get('invite') || '';

  const handleDone = async (team) => {
    await refreshTeams();
    await refreshLevels();
    switchTeam(team.id);
    navigate('/dashboard');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="au-page">
      <div className="au-card au-card-wide">
        <div className="au-logo" aria-hidden="true">T</div>
        <h1 className="au-title">{invite ? 'Join your team' : 'Set up your team'}</h1>
        <p className="au-sub">
          {invite
            ? 'Your invite code is filled in — join to get started.'
            : 'Everything in TaskFlow lives in a team. Start one, or join with an invite code.'}
        </p>
        <div style={{ marginTop: 26 }}>
          <TeamJoinCreateForm defaultCode={invite} onDone={handleDone} />
        </div>
      </div>
      <div className="au-below">
        Signed in as <span className="mono">{user?.email}</span> ·{' '}
        <button type="button" className="au-link" onClick={handleSignOut}>Sign out</button>
      </div>
    </div>
  );
}
