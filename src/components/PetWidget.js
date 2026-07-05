import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePets } from '../context/PetContext';
import { WidgetHead } from './dashboardWidgets';
import { maxHealthForLevel } from '../lib/petLogic';
import { petXpToNext } from '../lib/xp';
import { environmentUrl } from '../lib/petEnvironments';
import PetSprite from './PetSprite';
import LevelBar from './LevelBar';
import PetWidgetSettings from './PetWidgetSettings';
import './PetWidget.css';

const PET_ICON = 'M5 7 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M15 7 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M2.2 13 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 M18.2 13 a1.8 1.8 0 1 0 3.6 0 a1.8 1.8 0 1 0 -3.6 0 M6.5 17 a5.5 4.2 0 1 0 11 0 a5.5 4.2 0 1 0 -11 0';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

// Feed/water trail — how many icons fly per click, how long each flight
// takes, and the stagger between them launching.
const PARTICLE_COUNT = 6;
const FLIGHT_MS = 650;
const STAGGER_MS = 90;

const StatRing = React.forwardRef(function StatRing({ label, icon, value, max }, ref) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div ref={ref} className={`pet-stat-ring pet-stat-ring-${label.toLowerCase()}`} title={`${label}: ${Math.round(value)}/${Math.round(max)}`}>
      <svg width="34" height="34" viewBox="0 0 34 34">
        <circle cx="17" cy="17" r={RING_R} className="pet-stat-ring-track" />
        <circle
          cx="17" cy="17" r={RING_R}
          className="pet-stat-ring-fill"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - pct)}
          transform="rotate(-90 17 17)"
        />
      </svg>
      <span className="pet-stat-ring-icon">{icon}</span>
    </div>
  );
});

export default function PetWidget() {
  const navigate = useNavigate();
  const { activePet, feedPet, waterPet } = usePets();

  const [petPopKey, setPetPopKey] = useState(null);
  const [petPopAmt, setPetPopAmt] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      if (d.petXpGained) { setPetPopAmt(d.petXpGained); setPetPopKey(k => (k || 0) + 1); }
    };
    window.addEventListener('xp-awarded', handler);
    return () => window.removeEventListener('xp-awarded', handler);
  }, []);

  // ── Feed/water "trail" animation ────────────────────────────
  // Clicking feed/water updates the real value instantly (feedPet/waterPet
  // below), but the RING fills in visually over a few icons flying from the
  // button to it instead of jumping straight to full — displayHunger/Water
  // is a locally-animated stand-in for activePet.hunger/water, kept in sync
  // with the real value except while a trail we launched is actively
  // ramping it up itself (animatingRef), so the incoming refreshed prop
  // doesn't just snap it to 100 immediately.
  const stageRef = useRef(null);
  const feedBtnRef = useRef(null);
  const waterBtnRef = useRef(null);
  const foodRingRef = useRef(null);
  const waterRingRef = useRef(null);
  const animatingRef = useRef({ hunger: false, water: false });
  const nextParticleId = useRef(0);

  const [displayHunger, setDisplayHunger] = useState(activePet?.hunger ?? 0);
  const [displayWater, setDisplayWater] = useState(activePet?.water ?? 0);
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (activePet && !animatingRef.current.hunger) setDisplayHunger(activePet.hunger);
  }, [activePet?.id, activePet?.hunger]);
  useEffect(() => {
    if (activePet && !animatingRef.current.water) setDisplayWater(activePet.water);
  }, [activePet?.id, activePet?.water]);

  const launchTrail = useCallback((kind, btnRef, ringRef, setDisplay, startValue) => {
    const stageEl = stageRef.current;
    const btnEl = btnRef.current;
    const ringEl = ringRef.current;
    if (!stageEl || !btnEl || !ringEl) return;
    const stageRect = stageEl.getBoundingClientRect();
    const btnRect = btnEl.getBoundingClientRect();
    const ringRect = ringEl.getBoundingClientRect();
    const startX = btnRect.left + btnRect.width / 2 - stageRect.left;
    const startY = btnRect.top + btnRect.height / 2 - stageRect.top;
    const endX = ringRect.left + ringRect.width / 2 - stageRect.left;
    const endY = ringRect.top + ringRect.height / 2 - stageRect.top;

    animatingRef.current[kind] = true;
    const step = Math.max(0, 100 - startValue) / PARTICLE_COUNT;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const id = nextParticleId.current++;
      const jitter = () => (Math.random() - 0.5) * 10;
      setTimeout(() => {
        const sx = startX + jitter();
        const sy = startY + jitter();
        setParticles(p => [...p, { id, kind, x: sx, y: sy, flying: false }]);
        requestAnimationFrame(() => {
          setParticles(p => p.map(pt => (
            pt.id === id ? { ...pt, x: endX + jitter(), y: endY + jitter(), flying: true } : pt
          )));
        });
        setTimeout(() => {
          setParticles(p => p.filter(pt => pt.id !== id));
          const isLast = i === PARTICLE_COUNT - 1;
          setDisplay(v => (isLast ? 100 : Math.min(100, v + step)));
          if (isLast) animatingRef.current[kind] = false;
        }, FLIGHT_MS);
      }, i * STAGGER_MS);
    }
  }, []);

  if (!activePet) {
    return (
      <>
        <WidgetHead icon={PET_ICON} title="Your Pet" />
        <p className="widget-empty">No active pet yet.</p>
      </>
    );
  }

  const maxHealth = maxHealthForLevel(activePet.level);

  const handleFeed = () => {
    launchTrail('hunger', feedBtnRef, foodRingRef, setDisplayHunger, displayHunger);
    feedPet(activePet.id);
  };
  const handleWater = () => {
    launchTrail('water', waterBtnRef, waterRingRef, setDisplayWater, displayWater);
    waterPet(activePet.id);
  };

  return (
    <>
      <WidgetHead
        icon={PET_ICON}
        title="Your Pet"
        action={<span className="widget-count">Lv {activePet.level}</span>}
      />
      <div className="pet-widget-body">
        <div ref={stageRef} className="pet-widget-stage" style={{ backgroundImage: `url("${environmentUrl(activePet.environment)}")` }}>
          <PetSprite
            petId={activePet.id}
            species={activePet.species}
            style={activePet.style}
            size={84}
            dead={activePet.is_dead}
            idleAnimation={activePet.idle_animation}
            walkArea={activePet.walk_area}
          />

          <div className="pet-widget-rings">
            <StatRing label="Health" icon="❤️" value={activePet.health} max={maxHealth} />
            <StatRing ref={foodRingRef} label="Food" icon="🍗" value={displayHunger} max={100} />
            <StatRing ref={waterRingRef} label="Water" icon="💧" value={displayWater} max={100} />
          </div>

          <button
            className="pet-widget-gear-btn"
            onClick={() => setShowSettings(true)}
            aria-label="Pet settings"
            title="Pet settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>

          {particles.map(p => (
            <span
              key={p.id}
              className="pet-feed-particle"
              style={{
                left: p.x, top: p.y,
                opacity: p.flying ? 0 : 1,
                transition: p.flying
                  ? `left ${FLIGHT_MS}ms ease-in, top ${FLIGHT_MS}ms ease-in, opacity ${FLIGHT_MS}ms ease-in`
                  : 'none',
              }}
            >
              {p.kind === 'hunger' ? '🍗' : '💧'}
            </span>
          ))}

          <div className="pet-widget-overlay-actions">
            <button
              ref={feedBtnRef}
              className="pet-widget-icon-btn"
              onClick={handleFeed}
              disabled={activePet.is_dead}
              aria-label="Feed"
              title="Feed"
            >🍗</button>
            <button
              ref={waterBtnRef}
              className="pet-widget-icon-btn"
              onClick={handleWater}
              disabled={activePet.is_dead}
              aria-label="Water"
              title="Water"
            >💧</button>
          </div>
        </div>

        <div className="pet-widget-name">
          {activePet.name}
          {activePet.is_dead && <span className="pet-widget-dead-tag">Deceased</span>}
        </div>

        <LevelBar
          label={activePet.name} level={activePet.level} xp={activePet.xp}
          xpToNext={petXpToNext(activePet.level)} color="#a78bfa"
          popKey={petPopKey} popAmount={petPopAmt}
        />

        <button className="pet-widget-manage" onClick={() => navigate('/pets')}>
          Manage pets
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      {showSettings && <PetWidgetSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}
