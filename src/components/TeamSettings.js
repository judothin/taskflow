import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import {
  fetchTeamMembers, regenerateInviteCode, setMemberRole, removeMember, renameTeam, setTeamGamification,
} from '../lib/teams';
import { Icon, Avatar, Dialog, ConfirmDialog, Empty, SkeletonRows, fullName, toast } from '../ui';
import { SettingRow, Toggle } from './SettingsControls';
import TeamJoinCreateForm from './TeamJoinCreateForm';
import './TeamSettings.css';

function CopyButton({ value, label = 'Copy', primary, small = true }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1700);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { toast('Couldn’t reach the clipboard', { icon: 'alert' }); }
  };
  return (
    <button
      type="button"
      className={`btn ${primary ? 'btn-primary' : ''} ${small ? 'btn-sm' : ''} ts-copy ${copied ? 'is-done' : ''}`}
      onClick={copy}
    >
      <span key={copied ? 'y' : 'n'} className="ts-copy-in">
        <Icon name={copied ? 'check' : 'copy'} size={13} stroke={copied ? 2.6 : 1.9} />
        {copied ? 'Copied' : label}
      </span>
    </button>
  );
}

const ROLE_TAG = { owner: 'tag-purple', admin: 'tag-blue', member: 'tag-gray' };

export default function TeamSettings() {
  const { user } = useAuth();
  const { teams, activeTeam, activeTeamId, switchTeam, isOwner, isAdmin, refreshTeams } = useTeam();

  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removeText, setRemoveText] = useState('');
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [savingGamification, setSavingGamification] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!activeTeamId) { setMembers([]); setLoadingMembers(false); return; }
    setLoadingMembers(true);
    setMembers(await fetchTeamMembers(activeTeamId));
    setLoadingMembers(false);
  }, [activeTeamId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { setEditingName(false); setError(''); }, [activeTeamId]);

  const guestLink = activeTeam ? `${window.location.origin}/submit/${activeTeam.slug}` : '';
  const inviteLink = activeTeam ? `${window.location.origin}/register?invite=${activeTeam.invite_code}` : '';

  const run = async (fn, fallback) => {
    setError('');
    try { await fn(); return true; } catch (err) { setError(err.message || fallback); return false; }
  };

  const rename = async (e) => {
    e.preventDefault();
    if (!nameDraft.trim() || nameDraft.trim() === activeTeam.name) { setEditingName(false); return; }
    setRenaming(true);
    const ok = await run(async () => { await renameTeam(activeTeamId, nameDraft.trim()); await refreshTeams(); }, 'Failed to rename team');
    setRenaming(false);
    if (ok) { setEditingName(false); toast('Team renamed'); }
  };

  const addTeamDone = async (team) => {
    await refreshTeams();
    switchTeam(team.id);
    setShowAddTeam(false);
    toast(`Switched to ${team.name}`);
  };

  const toggleRole = async (m) => {
    setBusyId(m.id);
    await run(async () => { await setMemberRole(activeTeamId, m.id, m.role === 'admin' ? 'member' : 'admin'); await loadMembers(); }, 'Failed to update role');
    setBusyId(null);
  };

  const doRemove = async () => {
    if (!confirmRemove) return;
    setBusyId(confirmRemove.id);
    const name = fullName(confirmRemove);
    const ok = await run(async () => { await removeMember(activeTeamId, confirmRemove.id); await loadMembers(); }, 'Failed to remove member');
    setBusyId(null);
    if (ok) { setConfirmRemove(null); setRemoveText(''); toast(`${name} removed`); }
  };

  const doRegenerate = async () => {
    setRegenerating(true);
    const ok = await run(async () => { await regenerateInviteCode(activeTeamId); await refreshTeams(); }, 'Failed to regenerate code');
    setRegenerating(false);
    setConfirmRegen(false);
    if (ok) toast('New invite code ready');
  };

  const toggleGamification = async () => {
    setSavingGamification(true);
    await run(async () => { await setTeamGamification(activeTeamId, activeTeam.gamification_enabled === false); await refreshTeams(); }, 'Failed to update setting');
    setSavingGamification(false);
  };

  const removeName = confirmRemove ? fullName(confirmRemove) : '';
  const removeMatches = removeText.trim().toLowerCase() === removeName.toLowerCase();

  return (
    <div className="ts">
      <div className="st-rows stagger">
        <SettingRow label="Team" desc="The team you’re working in. Everything in TaskFlow belongs to one." top>
          <div className="chip-row ts-teams">
            {teams.map(t => (
              <button
                key={t.id}
                type="button"
                className={`chip-toggle ${t.id === activeTeamId ? 'is-on' : ''}`}
                onClick={() => switchTeam(t.id)}
                aria-pressed={t.id === activeTeamId}
              >
                {t.id === activeTeamId && <Icon name="check" size={13} stroke={2.6} className="ts-team-check" />}
                {t.name}
                <span className="ts-team-role">{t.role}</span>
              </button>
            ))}
            <button type="button" className="chip-toggle is-dashed" onClick={() => setShowAddTeam(true)}>
              <Icon name="plus" size={13} />Add team
            </button>
          </div>
        </SettingRow>

        {activeTeam && (
          <SettingRow label="Name" desc={isAdmin ? 'Owners and admins can rename the team.' : 'Only owners and admins can rename it.'}>
            {editingName ? (
              <form className="st-inline-form anim-fade" onSubmit={rename}>
                <input
                  className="input"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditingName(false); } }}
                  autoFocus
                  maxLength={80}
                />
                <button type="button" className="btn btn-ghost" onClick={() => setEditingName(false)} disabled={renaming}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={renaming || !nameDraft.trim()}>
                  {renaming ? <span className="spinner" /> : 'Save'}
                </button>
              </form>
            ) : (
              <>
                <span className="ts-name">{activeTeam.name}</span>
                {isAdmin && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNameDraft(activeTeam.name); setEditingName(true); }}>
                    <Icon name="edit" size={13} />Rename
                  </button>
                )}
              </>
            )}
          </SettingRow>
        )}

        {activeTeam && (
          <SettingRow label="Invite people" desc={<>Share the code or link so someone can join <strong>{activeTeam.name}</strong> as a member.</>} top col>
            <div className="ts-code">
              <span key={activeTeam.invite_code} className="ts-code-value">{activeTeam.invite_code}</span>
              <CopyButton value={activeTeam.invite_code} />
            </div>
            <div className="ts-actions">
              <CopyButton value={inviteLink} label="Copy invite link" />
              {isAdmin && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRegen(true)} disabled={regenerating}>
                  <Icon name="refresh" size={13} className={regenerating ? 'ts-spin' : ''} />New code
                </button>
              )}
            </div>
          </SettingRow>
        )}

        {activeTeam && (
          <SettingRow label="Guest portal" desc={<>Anyone with this link can send feedback to <strong>{activeTeam.name}</strong> — no account needed. It lands in Submissions.</>} top col>
            <div className="link-field">
              <Icon name="globe" size={15} />
              <span className="link-field-text">{guestLink}</span>
              <a className="link-open" href={guestLink} target="_blank" rel="noopener noreferrer">Open <Icon name="arrowUpRight" size={12} /></a>
            </div>
            <div className="ts-actions">
              <CopyButton value={guestLink} label="Copy link" />
              <CopyButton value={`Send feedback to ${activeTeam.name}: ${guestLink}`} label="Copy with a message" />
            </div>
          </SettingRow>
        )}

        {activeTeam && isAdmin && (
          <SettingRow
            label="Levels & XP"
            desc={<>When off, nobody sees levels or XP while working in <strong>{activeTeam.name}</strong>. Their XP still adds up in the background.</>}
          >
            <Toggle
              on={activeTeam.gamification_enabled !== false}
              onClick={toggleGamification}
              disabled={savingGamification}
              label="Levels and XP for this team"
            />
            <span key={String(activeTeam.gamification_enabled !== false)} className="st-note anim-fade">
              {activeTeam.gamification_enabled === false ? 'Off for this team' : 'On for this team'}
            </span>
          </SettingRow>
        )}
      </div>

      {error && (
        <div key={error} className="notice notice-error wiggle ts-error" role="alert">
          <Icon name="alert" size={15} /><span>{error}</span>
        </div>
      )}

      {!activeTeam ? (
        <Empty icon="users" title="No team selected" action={<button type="button" className="btn btn-primary" onClick={() => setShowAddTeam(true)}>Create or join a team</button>}>
          Create a team, or join one with an invite code.
        </Empty>
      ) : (
        <>
          <h2 className="st-group-title">
            Members
            {!loadingMembers && <span key={members.length} className="count bump">{members.length}</span>}
          </h2>
          <p className="st-group-sub">
            {isOwner ? 'You can make people admins, and remove anyone but yourself.'
              : isAdmin ? 'Admins can remove members. Only the owner can change roles.'
                : 'Everyone on this team.'}
          </p>
          <div className="table ts-table" style={{ '--cols': 'minmax(0, 1fr) 100px 190px' }}>
            <div className="table-head">
              <span>Member</span>
              <span className="hide-phone">Role</span>
              <span className="hide-phone" />
            </div>
            {loadingMembers ? (
              <SkeletonRows rows={3} widths={['40%', '12%', '18%']} />
            ) : (
              <div className="stagger">
                {members.map(m => {
                  const isSelf = m.id === user?.id;
                  const canRole = isOwner && m.role !== 'owner';
                  const canRemove = (isOwner && m.role !== 'owner' && !isSelf) || (isAdmin && !isOwner && m.role === 'member');
                  const busy = busyId === m.id;
                  return (
                    <div key={m.id} className="table-row is-static">
                      <div className="table-cell ts-member">
                        <Avatar person={m} size={32} />
                        <div style={{ minWidth: 0 }}>
                          <div className="table-title truncate">
                            {fullName(m)}
                            {isSelf && <span className="ts-you">you</span>}
                          </div>
                          <div className="table-sub">{m.email}</div>
                        </div>
                      </div>
                      <div className="table-cell">
                        <span className={`tag ${ROLE_TAG[m.role] || 'tag-gray'}`}>{m.role}</span>
                      </div>
                      <div className="table-cell ts-row-actions">
                        {canRole && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleRole(m)} disabled={busy}>
                            {busy ? <span className="spinner" /> : m.role === 'admin' ? 'Make member' : 'Make admin'}
                          </button>
                        )}
                        {canRemove && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            onClick={() => { setConfirmRemove(m); setRemoveText(''); setError(''); }}
                            aria-label={`Remove ${fullName(m)}`}
                            title="Remove from team"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showAddTeam && (
        <Dialog title="Add a team" text="Start a new team, or join one with the code a teammate sent you." onClose={() => setShowAddTeam(false)}>
          <div style={{ marginTop: 18, paddingBottom: 16 }}>
            <TeamJoinCreateForm onDone={addTeamDone} onCancel={() => setShowAddTeam(false)} />
          </div>
        </Dialog>
      )}

      {confirmRegen && (
        <ConfirmDialog
          title="Make a new invite code?"
          text="The current code and invite link stop working straight away. People already on the team aren’t affected."
          confirmLabel="Make new code"
          busy={regenerating}
          onConfirm={doRegenerate}
          onClose={() => !regenerating && setConfirmRegen(false)}
        />
      )}

      {confirmRemove && (
        <Dialog
          title="Remove member"
          text={<>This removes <strong>{removeName}</strong> from <strong>{activeTeam?.name}</strong>. They’ll lose access to all of this team’s tasks, reviews and files.</>}
          onClose={() => busyId !== confirmRemove.id && setConfirmRemove(null)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(null)} disabled={busyId === confirmRemove.id}>Cancel</button>
              <button type="button" className="btn btn-danger-solid" onClick={doRemove} disabled={!removeMatches || busyId === confirmRemove.id}>
                {busyId === confirmRemove.id ? <span className="spinner" /> : 'Remove member'}
              </button>
            </>
          )}
        >
          <label className="field" style={{ marginTop: 18 }}>
            <span className="field-label">Type <span className="mono">{removeName}</span> to confirm</span>
            <input
              className="input"
              value={removeText}
              onChange={e => setRemoveText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && removeMatches) doRemove(); }}
              autoFocus
            />
          </label>
          {error && <div key={error} className="field-error wiggle" style={{ marginTop: 10 }}>{error}</div>}
        </Dialog>
      )}
    </div>
  );
}
