import React, { useState, useEffect } from 'react';
import { createTeam, joinTeamByCode } from '../lib/teams';
import { Icon, Segmented } from '../ui';
import './TeamJoinCreateForm.css';

// "Create a team" / "Join with a code", used by Onboarding and the
// "Add a team" dialog in Settings › Teams.
export default function TeamJoinCreateForm({ defaultCode = '', onDone, onCancel }) {
  const [mode, setMode] = useState(defaultCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [code, setCode] = useState(defaultCode);
  const [error, setError] = useState('');
  const [errTick, setErrTick] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaultCode) { setMode('join'); setCode(defaultCode); }
  }, [defaultCode]);

  const fail = (msg) => { setError(msg); setErrTick(t => t + 1); };

  const submit = async (e) => {
    e.preventDefault();
    const creating = mode === 'create';
    const value = (creating ? name : code).trim();
    if (!value) { fail(creating ? 'Give the team a name.' : 'Enter the invite code.'); return; }
    setSaving(true); setError('');
    try {
      const team = creating ? await createTeam(value) : await joinTeamByCode(value);
      onDone?.(team);
    } catch (err) {
      fail(err.message || (creating ? 'Failed to create team' : 'Failed to join team'));
    } finally {
      setSaving(false);
    }
  };

  const switchMode = (m) => { setMode(m); setError(''); };

  return (
    <form className="tj" onSubmit={submit}>
      <Segmented
        value={mode}
        onChange={switchMode}
        options={[{ value: 'create', label: 'Create a team' }, { value: 'join', label: 'Join with a code' }]}
        ariaLabel="Create or join"
      />

      <label key={mode} className="field tj-field">
        {mode === 'create' ? (
          <>
            <span className="field-label">Team name</span>
            <input className="input" placeholder="e.g. Palmer Web" value={name} onChange={e => { setName(e.target.value); setError(''); }} autoFocus maxLength={80} />
            <span className="field-hint">You’ll be the owner. Invite people with a code afterwards.</span>
          </>
        ) : (
          <>
            <span className="field-label">Invite code</span>
            <input
              className="input input-mono tj-code"
              placeholder="AB12CD34"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
              autoFocus
              autoCapitalize="characters"
              spellCheck={false}
            />
            <span className="field-hint">Ask a teammate — it’s under Settings › Teams.</span>
          </>
        )}
      </label>

      {error && (
        <div key={errTick} className="notice notice-error wiggle" role="alert">
          <Icon name="alert" size={15} /><span>{error}</span>
        </div>
      )}

      <div className="tj-actions">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>}
        <button type="submit" className="btn btn-primary btn-lg tj-submit" disabled={saving}>
          {saving ? <span className="spinner" /> : mode === 'create' ? 'Create team' : 'Join team'}
          {!saving && <Icon name="arrowRight" size={15} />}
        </button>
      </div>
    </form>
  );
}
