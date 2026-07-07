import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePets } from '../context/PetContext';
import { speciesLabel, animationsFor, ANIMATION_LABELS, framePath } from '../lib/petSpecies';
import { maxHealthForLevel, unlockedStylesForLevel, sacrificeEligible } from '../lib/petLogic';
import { userXpToNext, petXpToNext } from '../lib/xp';
import { BUILTIN_ENVIRONMENTS, environmentUrl } from '../lib/petEnvironments';
import PetSprite from '../components/PetSprite';
import PetSpinReveal from '../components/PetSpinReveal';
import LevelBar from '../components/LevelBar';
import WalkAreaEditor from '../components/WalkAreaEditor';
import ModalPortal from '../components/ModalPortal';
import './Pets.css';

function StatBar({ label, value, max, color }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="pet-stat-row">
      <span className="pet-stat-label">{label}</span>
      <div className="pet-stat-track">
        <div className="pet-stat-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="pet-stat-val">{Math.round(value)}/{Math.round(max)}</span>
    </div>
  );
}

export default function Pets() {
  const navigate = useNavigate();
  const {
    userLevel, pets, activePet, customEnvironments, gamificationEnabled,
    feedPet, waterPet, renamePet, setActivePet, setPetStyle,
    setPetEnvironment, setPetWalkArea, setPetIdleAnimation, uploadPetEnvironment,
    sacrificeForNewPet,
  } = usePets();
  const [viewedId, setViewedId] = useState(null);
  const viewed = pets.find(p => p.id === viewedId) || activePet || pets[0] || null;

  // Not reachable via the nav when gamification is off (personally opted
  // out, or the active team has it disabled) — bounce away from direct
  // navigation too.
  useEffect(() => {
    if (!gamificationEnabled) navigate('/dashboard', { replace: true });
  }, [gamificationEnabled, navigate]);

  const [action, setAction] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingWalkArea, setEditingWalkArea] = useState(false);
  const [uploadingEnv, setUploadingEnv] = useState(false);
  const [sacrificing, setSacrificing] = useState(false);
  const [sacrificeResult, setSacrificeResult] = useState(null);
  const [error, setError] = useState('');
  const envFileRef = useRef();

  const [userPopKey, setUserPopKey] = useState(null);
  const [userPopAmt, setUserPopAmt] = useState(0);
  const [petPopKey, setPetPopKey] = useState(null);
  const [petPopAmt, setPetPopAmt] = useState(0);

  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      if (d.userXpGained) { setUserPopAmt(d.userXpGained); setUserPopKey(k => (k || 0) + 1); }
      if (d.petXpGained && viewed && activePet && viewed.id === activePet.id) {
        setPetPopAmt(d.petXpGained); setPetPopKey(k => (k || 0) + 1);
      }
    };
    window.addEventListener('xp-awarded', handler);
    return () => window.removeEventListener('xp-awarded', handler);
  }, [viewed, activePet]);

  const selectPet = (id) => { setViewedId(id); setAction(null); setEditingName(false); setEditingWalkArea(false); };

  const handleRename = async (e) => {
    e.preventDefault();
    if (!nameDraft.trim() || !viewed) return;
    await renamePet(viewed.id, nameDraft.trim());
    setEditingName(false);
  };

  const handleSaveWalkArea = async (area) => {
    await setPetWalkArea(viewed.id, area);
    setEditingWalkArea(false);
  };

  const handleEnvUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !viewed) return;
    if (file.size > 5 * 1024 * 1024) { setError('Image must be 5 MB or smaller.'); return; }
    setUploadingEnv(true);
    setError('');
    try {
      const url = await uploadPetEnvironment(file);
      await setPetEnvironment(viewed.id, url);
    } catch (err) {
      setError(err.message || 'Failed to upload environment');
    } finally {
      setUploadingEnv(false);
    }
  };

  const handleSacrifice = async () => {
    setSacrificing(true);
    setError('');
    try {
      const pet = await sacrificeForNewPet();
      setSacrificeResult(pet);
    } catch (err) {
      setError(err.message || 'Failed to sacrifice');
    } finally {
      setSacrificing(false);
    }
  };

  const eligible = sacrificeEligible(pets);

  if (pets.length === 0) {
    return (
      <div className="pets-page fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Pets</h1>
            <p className="page-subtitle">You don't have any pets yet.</p>
          </div>
        </div>
        <div className="empty-state">
          <h3>No pets yet</h3>
          <p>Level up to unlock your first companion.</p>
        </div>
      </div>
    );
  }

  const maxHealth = viewed ? maxHealthForLevel(viewed.level) : 1;
  const unlockedStyles = viewed ? unlockedStylesForLevel(viewed.level) : 1;
  const petXpNeeded = viewed ? petXpToNext(viewed.level) : 1;
  const userXpNeeded = userXpToNext(userLevel?.level || 1);

  return (
    <div className="pets-page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pets</h1>
          <p className="page-subtitle">{pets.length} pet{pets.length !== 1 ? 's' : ''} collected</p>
        </div>
      </div>

      <div className="card pets-card pets-your-level-card">
        <h2 className="pets-card-title">Your Level</h2>
        <LevelBar
          label="You" level={userLevel?.level || 1} xp={userLevel?.xp || 0}
          xpToNext={userXpNeeded} color="var(--accent)"
          popKey={userPopKey} popAmount={userPopAmt}
        />
      </div>

      <div className="pets-grid">
        {pets.map(p => (
          <button
            key={p.id}
            className={`pet-collection-card ${p.id === viewed?.id ? 'pet-collection-card-active' : ''} ${p.is_dead ? 'pet-collection-card-dead' : ''}`}
            onClick={() => selectPet(p.id)}
          >
            <div className="pet-collection-thumb">
              {/* Every pet in the collection animates independently and
                  simultaneously here (unlike the widget/detail view, which
                  only ever show one) — confirmed via logging that the
                  frame/src sequence itself is correct, so the flicker some
                  users saw was the aggregate paint cost of several
                  independently-ticking sprites at once, not a logic bug.
                  These are small list previews, not the main display, so a
                  much lower rate is a reasonable place to cut that cost. */}
              <PetSprite species={p.species} style={p.style} size={56} dead={p.is_dead} roam={false} idleAnimation={p.idle_animation} fps={3} />
            </div>
            <span className="pet-collection-name">{p.name}</span>
            <span className="pet-collection-level">Lv {p.level}</span>
            {p.is_active && <span className="pet-collection-tag pet-collection-tag-active">Active</span>}
            {p.is_dead && <span className="pet-collection-tag pet-collection-tag-dead">Deceased</span>}
          </button>
        ))}
      </div>

      {viewed && (
        <div className="pet-detail-grid">
          <div className="card pets-card">
            <div className="pet-detail-stage" style={{ backgroundImage: `url("${environmentUrl(viewed.environment)}")` }}>
              <PetSprite
                petId={viewed.id}
                species={viewed.species}
                style={viewed.style}
                size={140}
                dead={viewed.is_dead}
                action={action}
                onActionDone={() => setAction(null)}
                idleAnimation={viewed.idle_animation}
                walkArea={viewed.walk_area}
              />
              {editingWalkArea && (
                <WalkAreaEditor
                  initial={viewed.walk_area}
                  onSave={handleSaveWalkArea}
                  onCancel={() => setEditingWalkArea(false)}
                />
              )}
            </div>

            {editingName ? (
              <form className="pet-rename-form" onSubmit={handleRename}>
                <input className="input" value={nameDraft} onChange={e => setNameDraft(e.target.value)} autoFocus maxLength={30} />
                <button type="submit" className="btn btn-primary btn-sm">Save</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingName(false)}>Cancel</button>
              </form>
            ) : (
              <div className="pet-detail-name-row">
                <div>
                  <h2 className="pet-detail-name">{viewed.name}</h2>
                  <span className="pets-species-label">{speciesLabel(viewed.species)}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setNameDraft(viewed.name); setEditingName(true); }}>
                  Rename
                </button>
              </div>
            )}

            {!viewed.is_dead && (
              <div className="pet-action-picker">
                {animationsFor(viewed.species).map(anim => (
                  <button
                    key={anim}
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAction(anim)}
                    disabled={!!action}
                  >
                    {ANIMATION_LABELS[anim] || anim}
                  </button>
                ))}
              </div>
            )}

            <div className="pet-detail-buttons">
              <button className="btn btn-secondary" onClick={() => feedPet(viewed.id)} disabled={viewed.is_dead}>🍗 Feed</button>
              <button className="btn btn-secondary" onClick={() => waterPet(viewed.id)} disabled={viewed.is_dead}>💧 Water</button>
              <button className="btn btn-secondary" onClick={() => setEditingWalkArea(true)} disabled={viewed.is_dead || editingWalkArea}>
                Set Walking Area
              </button>
              {!viewed.is_active && !viewed.is_dead && (
                <button className="btn btn-primary" onClick={() => setActivePet(viewed.id)}>Set Active</button>
              )}
            </div>
          </div>

          <div className="pets-side-col">
            <div className="card pets-card">
              <h2 className="pets-card-title">Stats</h2>
              <div className="pet-stat-block">
                <StatBar label="HP"    value={viewed.health} max={maxHealth} color="#f87171" />
                <StatBar label="Food"  value={viewed.hunger} max={100}      color="#fbbf24" />
                <StatBar label="Water" value={viewed.water}  max={100}      color="#60a5fa" />
              </div>
              <LevelBar
                label={viewed.name} level={viewed.level} xp={viewed.xp}
                xpToNext={petXpNeeded} color="#a78bfa"
                popKey={petPopKey} popAmount={petPopAmt}
              />
            </div>

            <div className="card pets-card">
              <h2 className="pets-card-title">Style</h2>
              <div className="pet-style-grid">
                {[1, 2, 3].map(style => {
                  const unlocked = style <= unlockedStyles;
                  return (
                    <button
                      key={style}
                      className={`pet-style-tile ${viewed.style === style ? 'pet-style-tile-active' : ''} ${!unlocked ? 'pet-style-tile-locked' : ''}`}
                      onClick={() => unlocked && setPetStyle(viewed.id, style)}
                      disabled={!unlocked}
                    >
                      <img src={framePath(viewed.species, style, 'idle', 0)} alt="" />
                      <span>{unlocked ? `Style ${style}` : `Unlocks at Lv ${style === 2 ? 10 : 20}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card pets-card">
              <h2 className="pets-card-title">Idle Animation</h2>
              <p className="pets-card-desc">What {viewed.name} does while standing still — in the environment and the sidebar.</p>
              <div className="pet-action-picker">
                {animationsFor(viewed.species).map(anim => (
                  <button
                    key={anim}
                    className={`btn btn-secondary btn-sm ${(viewed.idle_animation || 'idle') === anim ? 'pet-idle-btn-active' : ''}`}
                    onClick={() => setPetIdleAnimation(viewed.id, anim)}
                  >
                    {ANIMATION_LABELS[anim] || anim}
                  </button>
                ))}
              </div>
            </div>

            <div className="card pets-card">
              <h2 className="pets-card-title">Environment</h2>
              <div className="pet-env-grid">
                {BUILTIN_ENVIRONMENTS.map(env => (
                  <button
                    key={env.key}
                    className={`pet-env-tile ${viewed.environment === env.key ? 'pet-env-tile-active' : ''}`}
                    onClick={() => setPetEnvironment(viewed.id, env.key)}
                  >
                    <img src={environmentUrl(env.key)} alt="" />
                    <span>{env.label}</span>
                  </button>
                ))}
                {customEnvironments.map(env => (
                  <button
                    key={env.id}
                    className={`pet-env-tile ${viewed.environment === env.url ? 'pet-env-tile-active' : ''}`}
                    onClick={() => setPetEnvironment(viewed.id, env.url)}
                  >
                    <img src={env.url} alt="" />
                    <span>Custom</span>
                  </button>
                ))}
                <button className="pet-env-tile pet-env-tile-upload" onClick={() => envFileRef.current?.click()} disabled={uploadingEnv}>
                  <span className="pet-env-upload-icon">+</span>
                  <span>{uploadingEnv ? 'Uploading…' : 'Upload'}</span>
                </button>
                <input ref={envFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleEnvUpload} />
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-msg" style={{ marginTop: 16 }}>⚠ {error}</div>}

      {eligible && (
        <div className="card pets-card pet-sacrifice-card">
          <div>
            <h2 className="pets-card-title" style={{ marginBottom: 4 }}>No living pets</h2>
            <p className="pets-card-desc" style={{ marginBottom: 0 }}>Sacrifice your user level (back to 1) for a fresh pet.</p>
          </div>
          <button className="btn btn-danger" onClick={handleSacrifice} disabled={sacrificing}>
            {sacrificing ? 'Sacrificing…' : 'Sacrifice for a new pet'}
          </button>
        </div>
      )}

      {sacrificeResult && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 3000 }}>
          <div className="modal pet-spin-modal">
            <div className="modal-header"><h2 style={{ fontSize: 18, fontWeight: 700 }}>New pet unlocked!</h2></div>
            <div className="modal-body">
              <PetSpinReveal
                result={sacrificeResult}
                onDone={() => { setViewedId(sacrificeResult.id); setSacrificeResult(null); }}
              />
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
