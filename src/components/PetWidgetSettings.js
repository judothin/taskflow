import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { usePets } from '../context/PetContext';
import { BUILTIN_ENVIRONMENTS, environmentUrl } from '../lib/petEnvironments';
import PetSprite from './PetSprite';

// Quick-access settings opened from the dashboard pet widget's gear icon —
// rename, swap active pet, and change background, without leaving the
// dashboard. Anything more involved (styles, walk area, sacrifice) stays on
// the full Pets page, linked at the bottom.
export default function PetWidgetSettings({ onClose }) {
  const navigate = useNavigate();
  const {
    pets, activePet, customEnvironments,
    renamePet, setActivePet, setPetEnvironment, uploadPetEnvironment,
  } = usePets();

  const [nameDraft, setNameDraft] = useState(activePet?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [uploadingEnv, setUploadingEnv] = useState(false);
  const [error, setError] = useState('');
  const envFileRef = useRef();

  const mouseDownOnOverlay = useRef(false);
  const handleOverlayMouseDown = (e) => { mouseDownOnOverlay.current = e.target === e.currentTarget; };
  const handleOverlayMouseUp = (e) => { if (mouseDownOnOverlay.current && e.target === e.currentTarget) onClose(); };

  if (!activePet) return null;

  const handleRename = async (e) => {
    e.preventDefault();
    if (!nameDraft.trim() || nameDraft.trim() === activePet.name) return;
    setSavingName(true);
    try {
      await renamePet(activePet.id, nameDraft.trim());
    } finally {
      setSavingName(false);
    }
  };

  const handleEnvUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Image must be 5 MB or smaller.'); return; }
    setUploadingEnv(true);
    setError('');
    try {
      const url = await uploadPetEnvironment(file);
      await setPetEnvironment(activePet.id, url);
    } catch (err) {
      setError(err.message || 'Failed to upload background');
    } finally {
      setUploadingEnv(false);
    }
  };

  const livingPets = pets.filter(p => !p.is_dead);

  // Rendered via a portal straight to <body> — this modal is opened from
  // inside a dashboard widget card, and `.dash-card` sets `contain: layout
  // paint` (for the GPU-layer/backdrop-filter tearing fix elsewhere in the
  // app), which makes any `position: fixed` descendant scope to that card's
  // box instead of the viewport. Escaping the card's DOM subtree entirely
  // is what actually fixes that, not just CSS.
  return createPortal(
    <div className="modal-overlay" onMouseDown={handleOverlayMouseDown} onMouseUp={handleOverlayMouseUp}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Pet Settings</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <form onSubmit={handleRename} className="form-group">
            <label className="label">Name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={24} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={savingName || !nameDraft.trim() || nameDraft.trim() === activePet.name}>
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>

          {livingPets.length > 1 && (
            <div className="form-group">
              <label className="label">Active Pet</label>
              <div className="pet-quickset-row">
                {livingPets.map(p => (
                  <button
                    key={p.id}
                    className={`pet-quickset-thumb ${p.id === activePet.id ? 'pet-quickset-thumb-active' : ''}`}
                    onClick={() => setActivePet(p.id)}
                    title={p.name}
                  >
                    <div className="pet-quickset-sprite">
                      <PetSprite species={p.species} style={p.style} size={34} roam={false} idleAnimation={p.idle_animation} />
                    </div>
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="label">Background</label>
            <div className="pet-env-grid">
              {BUILTIN_ENVIRONMENTS.map(env => (
                <button
                  key={env.key}
                  className={`pet-env-tile ${activePet.environment === env.key ? 'pet-env-tile-active' : ''}`}
                  onClick={() => setPetEnvironment(activePet.id, env.key)}
                >
                  <img src={environmentUrl(env.key)} alt="" />
                  <span>{env.label}</span>
                </button>
              ))}
              {customEnvironments.map(env => (
                <button
                  key={env.id}
                  className={`pet-env-tile ${activePet.environment === env.url ? 'pet-env-tile-active' : ''}`}
                  onClick={() => setPetEnvironment(activePet.id, env.url)}
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

          {error && <div className="error-msg">⚠ {error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={() => { onClose(); navigate('/pets'); }}>
            More options
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
