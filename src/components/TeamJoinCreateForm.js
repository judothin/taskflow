import React, { useState, useEffect } from 'react';
import { createTeam, joinTeamByCode } from '../lib/teams';
import './TeamJoinCreateForm.css';

// Shared "create a team" / "join with a code" toggle form, used by both the
// post-signup Onboarding page and the "Add Team" modal on the Teams page.
export default function TeamJoinCreateForm({ defaultCode = '', onDone, onCancel }) {
  const [mode, setMode] = useState(defaultCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [code, setCode] = useState(defaultCode);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaultCode) { setMode('join'); setCode(defaultCode); }
  }, [defaultCode]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Team name is required.'); return; }
    setSaving(true); setError('');
    try {
      const team = await createTeam(name.trim());
      onDone?.(team);
    } catch (err) {
      setError(err.message || 'Failed to create team');
    } finally {
      setSaving(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) { setError('Invite code is required.'); return; }
    setSaving(true); setError('');
    try {
      const team = await joinTeamByCode(code.trim());
      onDone?.(team);
    } catch (err) {
      setError(err.message || 'Failed to join team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="team-join-create fade-in">
      <div className="team-mode-toggle">
        <button
          type="button"
          className={`team-mode-btn ${mode === 'create' ? 'team-mode-btn-active' : ''}`}
          onClick={() => { setMode('create'); setError(''); }}
        >
          Create a team
        </button>
        <button
          type="button"
          className={`team-mode-btn ${mode === 'join' ? 'team-mode-btn-active' : ''}`}
          onClick={() => { setMode('join'); setError(''); }}
        >
          Join with a code
        </button>
      </div>

      {mode === 'create' ? (
        <form onSubmit={handleCreate} className="form-grid" style={{ gap: 14 }}>
          <div className="form-group">
            <label className="label">Team name</label>
            <input
              className="input"
              placeholder="e.g. Acme Inc."
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          {error && <div className="error-msg">⚠ {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>
              {saving ? 'Creating…' : 'Create Team'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleJoin} className="form-grid" style={{ gap: 14 }}>
          <div className="form-group">
            <label className="label">Invite code</label>
            <input
              className="input team-code-input"
              placeholder="e.g. AB12CD34"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              autoFocus
            />
          </div>
          {error && <div className="error-msg">⚠ {error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
            <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>
              {saving ? 'Joining…' : 'Join Team'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
