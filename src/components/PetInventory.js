import React from 'react';
import { usePets } from '../context/PetContext';
import { HUNGER_MAX, WATER_MAX } from '../lib/petLogic';
import './PetInventory.css';

// The food/water you own, spent by clicking to feed/water the given pet.
// Earned from creating & completing tasks and leveling up.
// `onUse(kind, sourceEl)` — optional; fired (with the clicked element) so a
// host can play a fly-to-the-bar animation. Feeding still happens regardless.
export default function PetInventory({ pet, onUse }) {
  const { food, water, feedPet, waterPet } = usePets();
  const dead = pet?.is_dead;

  const items = [
    { key: 'food',  icon: '🍗', label: 'Food',  count: food,  full: pet && pet.hunger >= HUNGER_MAX, use: () => feedPet(pet.id) },
    { key: 'water', icon: '💧', label: 'Water', count: water, full: pet && pet.water  >= WATER_MAX,  use: () => waterPet(pet.id) },
  ];

  const handleClick = (it, e) => {
    onUse?.(it.key, e.currentTarget);
    it.use();
  };

  return (
    <div className="pet-inv">
      {items.map(it => {
        const disabled = dead || it.count <= 0 || it.full;
        const title = dead ? 'Your pet has passed'
          : it.count <= 0 ? `No ${it.label.toLowerCase()} — earn more by creating & completing tasks`
          : it.full ? `${it.label} is already full`
          : `Use ${it.label.toLowerCase()} on ${pet.name}`;
        return (
          <button
            key={it.key}
            type="button"
            className="pet-inv-item"
            onClick={(e) => handleClick(it, e)}
            disabled={disabled}
            title={title}
          >
            <span className="pet-inv-icon">{it.icon}</span>
            <span className="pet-inv-text">
              <span className="pet-inv-label">{it.label}</span>
              <span className="pet-inv-count">×{it.count}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
