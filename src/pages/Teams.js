import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers, regenerateInviteCode, setMemberRole, removeMember, renameTeam, setTeamGamification } from '../lib/teams';
import TeamJoinCreateForm from '../components/TeamJoinCreateForm';
import Avatar from '../components/Avatar';
import ModalPortal from '../components/ModalPortal';
import './Teams.css';

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — no-op */ }
  };
  return (
    <button type="button" className={`btn btn-secondary btn-sm ${copied ? 'team-copy-done' : ''}`} onClick={handleCopy}>
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          {label}
        </>
      )}
    </button>
  );
}

export default function Teams() {
  const { user } = useAuth();
  const { teams, activeTeam, activeTeamId, switchTeam, isOwner, isAdmin, refreshTeams } = useTeam();

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // member object, or null
  const [removeConfirmText, setRemoveConfirmText] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [savingGamification, setSavingGamification] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!activeTeamId) { setMembers([]); setLoadingMembers(false); return; }
    setLoadingMembers(true);
    const list = await fetchTeamMembers(activeTeamId);
    setMembers(list);
    setLoadingMembers(false);
  }, [activeTeamId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => { setEditingName(false); setRenameError(''); }, [activeTeamId]);

  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    setRenaming(true);
    setRenameError('');
    try {
      await renameTeam(activeTeamId, nameDraft.trim());
      await refreshTeams();
      setEditingName(false);
    } catch (err) {
      setRenameError(err.message || 'Failed to rename team');
    } finally {
      setRenaming(false);
    }
  };

  const guestLink = activeTeam ? `${window.location.origin}/submit/${activeTeam.slug}` : '';
  const inviteLink = activeTeam ? `${window.location.origin}/register?invite=${activeTeam.invite_code}` : '';

  const handleAddTeamDone = async (team) => {
    await refreshTeams();
    switchTeam(team.id);
    setShowAddTeam(false);
  };

  const handleToggleRole = async (member) => {
    setError('');
    setBusyId(member.id);
    try {
      await setMemberRole(activeTeamId, member.id, member.role === 'admin' ? 'member' : 'admin');
      await loadMembers();
    } catch (err) {
      setError(err.message || 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const openRemoveConfirm = (member) => {
    setConfirmRemove(member);
    setRemoveConfirmText('');
    setError('');
  };

  const handleRemoveConfirmed = async () => {
    if (!confirmRemove) return;
    setError('');
    setBusyId(confirmRemove.id);
    try {
      await removeMember(activeTeamId, confirmRemove.id);
      setConfirmRemove(null);
      setRemoveConfirmText('');
      await loadMembers();
    } catch (err) {
      setError(err.message || 'Failed to remove member');
    } finally {
      setBusyId(null);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError('');
    try {
      await regenerateInviteCode(activeTeamId);
      await refreshTeams();
    } catch (err) {
      setError(err.message || 'Failed to regenerate code');
    } finally {
      setRegenerating(false);
    }
  };

  const handleToggleGamification = async () => {
    setSavingGamification(true);
    setError('');
    try {
      await setTeamGamification(activeTeamId, activeTeam.gamification_enabled === false);
      await refreshTeams();
    } catch (err) {
      setError(err.message || 'Failed to update setting');
    } finally {
      setSavingGamification(false);
    }
  };

  return (
    <div className="teams-page fade-in">

      {/* ── Team switcher ── */}
      <div className="team-switcher-row">
        {teams.map(t => (
          <button
            key={t.id}
            className={`team-pill ${t.id === activeTeamId ? 'team-pill-active' : ''}`}
            onClick={() => switchTeam(t.id)}
          >
            <span className="team-pill-dot" />
            {t.name}
            <span className="team-pill-role">{t.role}</span>
          </button>
        ))}
        <button className="team-pill team-pill-add" onClick={() => setShowAddTeam(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Team
        </button>
      </div>

      {!activeTeam ? (
        <div className="empty-state">
          <h3>No team selected</h3>
          <p>Create or join a team to get started.</p>
        </div>
      ) : (
        <>
          <div className="team-name-header">
            {editingName ? (
              <form className="team-name-edit-form" onSubmit={handleRenameSubmit}>
                <input
                  className="input"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  autoFocus
                  maxLength={80}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={renaming}>
                  {renaming ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingName(false)} disabled={renaming}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <h2 className="team-name-title">{activeTeam.name}</h2>
                {isAdmin && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setNameDraft(activeTeam.name); setEditingName(true); }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Rename
                  </button>
                )}
              </>
            )}
          </div>
          {renameError && <div className="error-msg" style={{ marginBottom: 14 }}>⚠ {renameError}</div>}

          <div className="teams-detail-grid">
          {/* ── Members ── */}
          <div className="card team-card">
            <h2 className="team-card-title">
              Members
              <span className="team-card-count">{members.length}</span>
            </h2>

            {error && <div className="error-msg" style={{ marginBottom: 12 }}>⚠ {error}</div>}

            {loadingMembers ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3].map(i => <div key={i} className="loading-pulse" style={{ height: 52, borderRadius: 'var(--radius)', background: 'var(--bg-4)' }} />)}
              </div>
            ) : (
              <div className="team-member-list">
                {members.map(m => {
                  const isSelf = m.id === user?.id;
                  const canManageRole = isOwner && m.role !== 'owner';
                  const canRemove = (isOwner && m.role !== 'owner' && !isSelf) || (isAdmin && !isOwner && m.role === 'member');
                  const isBusy = busyId === m.id;
                  return (
                    <div className="team-member-row" key={m.id}>
                      <Avatar src={m.avatar_url} color={m.color} initials={`${m.first_name?.[0] || ''}${m.last_name?.[0] || ''}`.toUpperCase()} size={36} />
                      <div className="team-member-info">
                        <span className="team-member-name">
                          {m.first_name} {m.last_name}
                          {isSelf && <span className="team-member-you">you</span>}
                        </span>
                        <span className="team-member-email">{m.email}</span>
                      </div>
                      <span className={`team-role-badge team-role-badge-${m.role}`}>{m.role}</span>

                      {canManageRole && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleToggleRole(m)} disabled={isBusy}>
                          {m.role === 'admin' ? 'Make Member' : 'Make Admin'}
                        </button>
                      )}

                      {canRemove && (
                        <button className="task-action-btn task-action-btn-danger" aria-label="Remove member" onClick={() => openRemoveConfirm(m)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6 M14 11v6"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Invite + guest link ── */}
          <div className="teams-side-col">
            <div className="card team-card">
              <h2 className="team-card-title">Invite people</h2>
              <p className="team-card-desc">Share this code (or link) so someone can join <strong>{activeTeam.name}</strong> as a member.</p>
              <div className="team-code-box">
                <span className="team-code-value">{activeTeam.invite_code}</span>
                <CopyButton value={activeTeam.invite_code} />
              </div>
              <div className="team-link-row">
                <CopyButton value={inviteLink} label="Copy invite link" />
                {isAdmin && (
                  <button className="btn btn-ghost btn-sm" onClick={handleRegenerate} disabled={regenerating}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                    {regenerating ? 'Regenerating…' : 'Regenerate code'}
                  </button>
                )}
              </div>
            </div>

            <div className="card team-card">
              <h2 className="team-card-title">Guest portal</h2>
              <p className="team-card-desc">Anyone with this link can submit a task to <strong>{activeTeam.name}</strong> without an account.</p>
              <div className="team-guest-link-box">
                <span className="team-guest-link-value">{guestLink}</span>
              </div>
              <CopyButton value={`Submit a task to ${activeTeam.name}: ${guestLink}`} label="Copy guest link" />
            </div>

            {isAdmin && (
              <div className="card team-card">
                <h2 className="team-card-title">Pets &amp; Levels</h2>
                <p className="team-card-desc">
                  When off, no one on <strong>{activeTeam.name}</strong> sees levels, XP animations, or the pet
                  widget/page while working in this team. Their own XP still accrues in the background — switching
                  to a team where this is on reveals whatever they've earned.
                </p>
                <div className="theme-color-row" style={{ borderBottom: 'none', paddingLeft: 0, paddingRight: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {activeTeam.gamification_enabled === false ? 'Disabled for this team' : 'Enabled for this team'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`nc-toggle ${activeTeam.gamification_enabled !== false ? 'nc-toggle-on' : ''}`}
                    onClick={handleToggleGamification}
                    disabled={savingGamification}
                    role="switch"
                    aria-checked={activeTeam.gamification_enabled !== false}
                  >
                    <span className="nc-toggle-thumb" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {showAddTeam && (
        <ModalPortal>
        <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowAddTeam(false); }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Add a Team</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTeam(false)}>✕</button>
            </div>
            <div className="modal-body">
              <TeamJoinCreateForm onDone={handleAddTeamDone} onCancel={() => setShowAddTeam(false)} />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {confirmRemove && (() => {
        const targetName = `${confirmRemove.first_name} ${confirmRemove.last_name}`.trim();
        const matches = removeConfirmText.trim().toLowerCase() === targetName.toLowerCase();
        const isBusy = busyId === confirmRemove.id;
        return (
          <ModalPortal>
          <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmRemove(null); }}>
            <div className="modal" style={{ maxWidth: 420 }}>
              <div className="modal-header">
                <h2 style={{ fontSize: 17, fontWeight: 700 }}>Remove member</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(null)}>✕</button>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
                  This removes <strong>{targetName}</strong> from <strong>{activeTeam?.name}</strong> — they'll lose access to all of this team's tasks, projects, and files.
                </p>
                <div className="form-group">
                  <label className="label">Type "{targetName}" to confirm</label>
                  <input
                    className="input"
                    value={removeConfirmText}
                    onChange={e => setRemoveConfirmText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && matches && !isBusy) handleRemoveConfirmed(); }}
                    autoFocus
                  />
                </div>
                {error && <div className="error-msg" style={{ marginTop: 10 }}>⚠ {error}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setConfirmRemove(null)} disabled={isBusy}>Cancel</button>
                <button className="btn btn-danger" onClick={handleRemoveConfirmed} disabled={!matches || isBusy}>
                  {isBusy ? 'Removing…' : 'Remove Member'}
                </button>
              </div>
            </div>
          </div>
          </ModalPortal>
        );
      })()}
    </div>
  );
}
