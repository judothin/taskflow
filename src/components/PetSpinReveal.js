import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SPECIES_KEYS, speciesLabel, framePath } from '../lib/petSpecies';
import './PetSpinReveal.css';

const TILE_COUNT = 46;
const WIN_INDEX = 40;
const TILE_WIDTH = 112; // includes gap — must match .pet-spin-tile's width + margin in the CSS
const SPIN_MS = 4800;
const SPIN_EASING = 'cubic-bezier(0.1, 0.7, 0.1, 1)';

function buildReel(winningSpecies) {
  const tiles = Array.from({ length: TILE_COUNT }, (_, i) => ({
    key: i,
    species: i === WIN_INDEX ? winningSpecies : SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)],
  }));
  return tiles;
}

// A CS:GO-case-style reveal: a long strip of mostly-decoy species tiles
// scrolls and eases to a stop with the true `result` centered under the
// marker, then shows a glow/scale flourish + the result card.
//
// Driven with the Web Animations API (trackRef.animate(...)) rather than a
// React-state-driven CSS transition. A CSS transition only animates if the
// browser has already painted the *starting* value on its own, which is a
// timing race (extra rAFs made it more likely, not guaranteed) — it was
// sometimes just snapping straight to the end position with no visible
// spin. WAAPI keyframes are explicit (from X to Y over Z ms) and start
// immediately when `.animate()` is called, so there's nothing to race.
export default function PetSpinReveal({ result, onDone }) {
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const reel = useMemo(() => buildReel(result.species), [result.species]);

  useEffect(() => {
    if (!stageRef.current) return;
    setStageWidth(stageRef.current.clientWidth);
  }, []);

  useEffect(() => {
    if (!trackRef.current || stageWidth <= 0) return undefined;
    const offset = WIN_INDEX * TILE_WIDTH + TILE_WIDTH / 2 - stageWidth / 2;

    const anim = trackRef.current.animate(
      [
        { transform: 'translateX(0px)' },
        { transform: `translateX(${-offset}px)` },
      ],
      { duration: SPIN_MS, easing: SPIN_EASING, fill: 'forwards' }
    );

    let fallbackTimer;
    const reveal = () => setRevealed(true);
    anim.onfinish = reveal;
    // Belt-and-braces: if `finish` somehow never fires (tab backgrounded,
    // animation canceled by something else), reveal anyway once the
    // duration has clearly elapsed rather than leaving the reel stuck.
    fallbackTimer = setTimeout(reveal, SPIN_MS + 300);

    return () => {
      anim.cancel();
      clearTimeout(fallbackTimer);
    };
  }, [stageWidth]);

  return (
    <div className="pet-spin">
      <div className="pet-spin-stage" ref={stageRef}>
        <div className="pet-spin-marker" />
        <div ref={trackRef} className="pet-spin-track">
          {reel.map(tile => (
            <div key={tile.key} className="pet-spin-tile">
              <img src={framePath(tile.species, 1, 'idle', 0)} alt="" draggable={false} />
            </div>
          ))}
        </div>
        <div className="pet-spin-fade pet-spin-fade-left" />
        <div className="pet-spin-fade pet-spin-fade-right" />
      </div>

      {revealed && (
        <div className="pet-spin-result fade-in">
          <div className="pet-spin-result-glow" />
          <img className="pet-spin-result-img" src={framePath(result.species, 1, 'idle', 0)} alt="" draggable={false} />
          <h2 className="pet-spin-result-title">You got a {speciesLabel(result.species)}!</h2>
          <button className="btn btn-primary" onClick={onDone}>Nice!</button>
        </div>
      )}
    </div>
  );
}
