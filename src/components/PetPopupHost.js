import React from 'react';
import { usePets } from '../context/PetContext';
import PetLevelUpToast from './PetLevelUpToast';
import PetLevelUpModal from './PetLevelUpModal';
import PetSpinModal from './PetSpinModal';

// Mounted once at the app root (see App.js). Renders whatever popup
// PetContext currently has queued — a plain user level-up toast, a pet
// level-up modal, or a milestone spin modal — one at a time.
export default function PetPopupHost() {
  const { currentPopup, dismissPopup, gamificationEnabled } = usePets();
  // Popups keep queuing up in PetContext even while hidden (e.g. the
  // active team has gamification turned off) — they just don't render
  // until gamificationEnabled becomes true again, which is what makes
  // switching to a team where it's on "reveal" everything earned since.
  if (!currentPopup || !gamificationEnabled) return null;

  switch (currentPopup.type) {
    case 'toast':
      return <PetLevelUpToast levelsGained={currentPopup.payload.levelsGained} onDone={dismissPopup} />;
    case 'petLevelUp':
      return <PetLevelUpModal petLevelUp={currentPopup.payload} onClose={dismissPopup} />;
    case 'spin':
      return <PetSpinModal onClose={dismissPopup} />;
    default:
      return null;
  }
}
