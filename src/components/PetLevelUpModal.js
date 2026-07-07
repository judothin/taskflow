import React from 'react';
import ModalPortal from './ModalPortal';
import PetSprite from './PetSprite';
import './PetLevelUpModal.css';

export default function PetLevelUpModal({ petLevelUp, onClose }) {
  const {
    petName, petSpecies, petStyle, levelsGained, newLevel,
    healthGained, newHealth, newMaxHealth, styleUnlocked,
  } = petLevelUp;

  return (
    <ModalPortal>
    <div className="modal-overlay" style={{ zIndex: 3000 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pet-levelup-modal">
        <div className="modal-header">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{petName} leveled up!</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body pet-levelup-body">
          <div className="pet-levelup-sprite">
            <PetSprite species={petSpecies} style={petStyle} size={100} />
          </div>
          <div className="pet-levelup-stats">
            <div className="pet-levelup-row">
              <span>Level</span>
              <strong>{newLevel - levelsGained} → {newLevel}</strong>
            </div>
            <div className="pet-levelup-row">
              <span>Health</span>
              <strong className="pet-levelup-health">+{healthGained} ({newHealth}/{newMaxHealth})</strong>
            </div>
          </div>
          {styleUnlocked && (
            <div className="pet-levelup-style-unlock">
              🎉 New style unlocked! Change it any time on the Pets page.
            </div>
          )}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>
            Nice!
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
