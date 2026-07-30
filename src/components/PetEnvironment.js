import React, { useEffect, useRef, useCallback } from 'react';
import { framePath, frameCount, animationsFor } from '../lib/petSpecies';
import { DEFAULT_WALK_AREA, isValidWalkArea } from '../lib/petLogic';
import './PetEnvironment.css';

// ============================================================
// Shared scene — every living pet roams one stage together.
//  • Movement scales with "energy" (food + water): full pets dart around
//    sporadically, hungry ones go slow and droopy.
//  • Pets occasionally pick fights (up close); you break one up by grabbing a
//    fighter and dragging it away — on release it falls (gravity) and faints
//    down into the walking area.
//  • Clicking (not dragging) a pet FOCUSES it; feeding is done from the panel
//    once a pet is focused.
//  • Uses the full breadth of each species' animation set — varied attacks,
//    hurt recoils, and playful idles — not just idle/walk.
//
// One requestAnimationFrame loop owns the whole simulation and writes
// positions/frames straight to the DOM (no per-frame React re-render), so it
// stays smooth with several sprites on screen at once.
// ============================================================

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(v, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const hyp = (dx, dy) => Math.hypot(dx, dy);

const BASE_FRACTION = 0.3;    // sprite height as a fraction of stage height
const BREAK_DIST = 22;        // % apart needed to end a fight by dragging
const DRAG_THRESHOLD = 6;     // px of pointer travel before it's a drag, not a click
const FIGHT_GAP = 4;          // % between two brawlers — small so they actually clash
const FLOOR_MIN = 84;         // where a dropped pet lands (bottom walking band)

// Animation pools — filtered per species to whatever it actually ships.
const ATTACK_ANIMS = ['attacking', 'slashing', 'slashing-in-the-air', 'kicking', 'throwing', 'throwing-in-the-air', 'casting-spells', 'taunt'];
const IDLE_FUN_ANIMS = ['taunt', 'casting-spells', 'jump-start', 'sliding', 'idle-blink', 'idle-blinking'];

const poolFor = (species, list) => list.filter(a => frameCount(species, a) > 1);
const hasAnim = (species, a) => frameCount(species, a) > 1;

// Preload every frame a shown pet might use, so switching animations never
// shows an undecoded (blank/flashing) frame. Cached across mounts.
const preloadCache = new Set();
function preloadPet(species, style) {
  animationsFor(species).forEach(anim => {
    const count = frameCount(species, anim);
    for (let i = 0; i < count; i++) {
      const src = framePath(species, style, anim, i);
      if (!preloadCache.has(src)) { preloadCache.add(src); const img = new Image(); img.src = src; }
    }
  });
}

function idleAnimFor(pet) {
  const a = pet.idle_animation;
  return a && hasAnim(pet.species, a) ? a : 'idle';
}
function fallAnimFor(species) {
  for (const a of ['falling-down', 'jump-loop', 'sliding', 'hurt']) if (hasAnim(species, a)) return a;
  return 'idle';
}
function faintAnimFor(species) {
  for (const a of ['hurt', 'dying']) if (hasAnim(species, a)) return a;
  return 'idle';
}
function moveAnimFor(species, running) {
  if (running && hasAnim(species, 'running')) return 'running';
  return 'walking';
}
// Each pet's roam box in stage percentages (from its saved walk_area, or a
// sensible default lower band).
function petBox(pet) {
  const wa = isValidWalkArea(pet.walk_area) ? pet.walk_area : DEFAULT_WALK_AREA;
  const x = clamp(wa.x * 100, 0, 92);
  const y = clamp(wa.y * 100, 0, 92);
  const w = clamp(wa.w * 100, 8, 100 - x);
  const h = clamp(wa.h * 100, 8, 100 - y);
  return { x, y, w, h };
}

export default function PetEnvironment({
  pets, backgroundUrl, height = '420px', aspectRatio = null, compact = false,
  activeId = null, focusedId = null, onFocus, oneShot = null,
}) {
  const stageRef = useRef(null);
  const anchors = useRef({}); // id -> anchor <div>
  const imgs = useRef({});    // id -> <img>
  const sparks = useRef({});  // id -> spark <div>
  const sim = useRef({ P: {}, nextFightAt: 6000 });
  const drag = useRef(null);
  const petsRef = useRef(pets);
  petsRef.current = pets;

  const setAnchor = useCallback((id, el) => { if (el) anchors.current[id] = el; else delete anchors.current[id]; }, []);
  const setImg = useCallback((id, el) => { if (el) imgs.current[id] = el; else delete imgs.current[id]; }, []);
  const setSpark = useCallback((id, el) => { if (el) sparks.current[id] = el; else delete sparks.current[id]; }, []);

  const stagePct = useCallback((clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect();
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 3, 97),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 30, 96),
    };
  }, []);

  // ── The simulation loop ──────────────────────────────────
  useEffect(() => {
    let rafId;
    let last = performance.now();
    sim.current.nextFightAt = last + rand(9000, 16000); // grace period before the first scrap

    const toIdle = (s, now) => {
      s.state = 'idle'; s.partner = null; s.fx = null; s.fy = null;
      s.decisionAt = now + rand(300, 900);
    };

    const startFight = (a, b, now) => {
      const cx = (a.x + b.x) / 2;
      const cy = Math.max(a.y, b.y);
      const aLeft = a.x <= b.x;
      a.state = b.state = 'fight';
      a.partner = b.id; b.partner = a.id;
      a.fx = cx + (aLeft ? -FIGHT_GAP : FIGHT_GAP); a.fy = cy;
      b.fx = cx + (aLeft ? FIGHT_GAP : -FIGHT_GAP); b.fy = cy;
      // The brawl resolves itself after a bit — one gets knocked down.
      a.fightUntil = b.fightUntil = now + rand(6000, 13000);
      a.loserId = b.loserId = Math.random() < 0.5 ? a.id : b.id;
      a.nextMoveAt = b.nextMoveAt = 0;
    };

    const step = (now) => {
      rafId = requestAnimationFrame(step);
      const dtMs = Math.min(64, now - last);
      last = now;
      const dt = dtMs / 1000;

      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;

      const P = sim.current.P;
      const pmap = {};
      petsRef.current.forEach(p => { pmap[p.id] = p; });
      const ids = Object.keys(pmap);

      // Sync sim entries with the current pet list.
      ids.forEach(id => {
        if (!P[id]) {
          const box = petBox(pmap[id]);
          P[id] = {
            id, x: rand(box.x, box.x + box.w), y: rand(box.y + box.h * 0.4, box.y + box.h),
            tx: 0, ty: 0, facing: 1, state: 'idle',
            anim: 'idle', frame: 0, frameAcc: 0,
            decisionAt: now + rand(200, 1400), partner: null,
            fx: null, fy: null, fightUntil: 0, nextMoveAt: 0,
            burst: 1, vy: 0, landingY: 90, faintOnLand: false, lastSrc: '',
          };
        }
      });
      Object.keys(P).forEach(id => { if (!pmap[id]) delete P[id]; });

      // Maybe start a fight — much rarer than before.
      if (now > sim.current.nextFightAt) {
        sim.current.nextFightAt = now + rand(16000, 32000);
        const free = ids.filter(id => P[id].state === 'idle' || P[id].state === 'walk');
        const anyFighting = ids.some(id => P[id].state === 'fight');
        if (free.length >= 2 && !anyFighting && Math.random() < 0.5) {
          const a = P[pick(free)];
          let b = null, bd = Infinity;
          free.forEach(id => {
            if (id === a.id) return;
            const d = hyp(P[id].x - a.x, P[id].y - a.y);
            if (d < bd) { bd = d; b = P[id]; }
          });
          if (b) startFight(a, b, now);
        }
      }

      ids.forEach(id => {
        const pet = pmap[id];
        const s = P[id];
        const anchor = anchors.current[id];
        const img = imgs.current[id];
        if (!anchor || !img) return;
        const species = pet.species;

        const energy = clamp01(((Number(pet.hunger) || 0) + (Number(pet.water) || 0)) / 200);
        const speed = lerp(4, 20, energy);
        const idleMin = lerp(3200, 700, energy);
        const idleMax = lerp(6000, 1900, energy);

        if (s.state === 'drag') {
          s.anim = moveAnimFor(species, true);
        } else if (s.state === 'drop') {
          s.vy += 130 * dt;              // gravity
          s.y += s.vy * dt;
          s.anim = fallAnimFor(species);
          if (s.y >= s.landingY) {
            s.y = s.landingY; s.vy = 0;
            if (s.faintOnLand) { s.state = 'faint'; s.anim = faintAnimFor(species); s.frame = 0; s.frameAcc = 0; }
            else toIdle(s, now);
          }
        } else if (s.state === 'action' || s.state === 'faint') {
          s.anim = s.state === 'faint' ? faintAnimFor(species) : (s.actionAnim || idleAnimFor(pet));
        } else if (s.state === 'fight') {
          const p = P[s.partner];
          if (!p || (p.state !== 'fight' && p.state !== 'drag')) {
            toIdle(s, now);
          } else if (p.state === 'fight' && now > s.fightUntil) {
            // Natural end — one pet knocks the other down, both stop.
            const loser = P[s.loserId] || s;
            const winner = P[loser.partner] || p;
            const wPet = pmap[winner.id];
            loser.state = 'faint'; loser.anim = faintAnimFor(pmap[loser.id].species);
            loser.frame = 0; loser.frameAcc = 0; loser.partner = null;
            loser.facing = winner.x >= loser.x ? -1 : 1; // reel away from the winner
            winner.state = 'action';
            winner.actionAnim = hasAnim(wPet.species, 'taunt') ? 'taunt' : idleAnimFor(wPet);
            winner.frame = 0; winner.frameAcc = 0; winner.partner = null;
            winner.facing = loser.x >= winner.x ? 1 : -1;
          } else {
            const dx = s.fx - s.x, dy = s.fy - s.y;
            const d = hyp(dx, dy);
            if (d > 2.5) {
              s.anim = moveAnimFor(species, true); // charge in
              const stpe = 20 * dt;
              s.x += (dx / d) * Math.min(stpe, d);
              s.y += (dy / d) * Math.min(stpe, d);
            } else {
              // Clash: rotate through this species' varied attack + hurt moves.
              s.x = s.fx + Math.sin(now / 60) * 0.8;
              if (now > s.nextMoveAt) {
                const attacks = poolFor(species, ATTACK_ANIMS);
                if (hasAnim(species, 'hurt') && Math.random() < 0.28) s.anim = 'hurt';
                else s.anim = attacks.length ? pick(attacks) : 'walking';
                s.frame = 0;
                s.nextMoveAt = now + rand(420, 820);
              }
            }
            s.facing = p.x >= s.x ? 1 : -1;
          }
        } else {
          // idle / walk wander
          if (now > s.decisionAt) {
            if (s.state === 'walk') {
              s.state = 'idle';
              const fun = poolFor(species, IDLE_FUN_ANIMS);
              s.anim = fun.length && Math.random() < 0.4 ? pick(fun) : idleAnimFor(pet);
              s.decisionAt = now + rand(idleMin, idleMax);
            } else {
              const box = petBox(pet);
              s.tx = box.x + Math.random() * box.w;
              s.ty = box.y + Math.random() * box.h;
              s.burst = energy > 0.7 && Math.random() < 0.45 ? 1.9 : 1; // full = sporadic darts
              s.state = 'walk';
              s.anim = moveAnimFor(species, s.burst > 1);
              s.facing = s.tx >= s.x ? 1 : -1;
              const d = hyp(s.tx - s.x, s.ty - s.y);
              s.decisionAt = now + (d / (speed * s.burst)) * 1000 + 60;
            }
          }
          if (s.state === 'walk') {
            const dx = s.tx - s.x, dy = s.ty - s.y;
            const d = hyp(dx, dy);
            const stpe = speed * (s.burst || 1) * dt;
            if (d > 0.001) {
              s.x += (dx / d) * Math.min(stpe, d);
              s.y += (dy / d) * Math.min(stpe, d);
              if (Math.abs(dx) > 0.2) s.facing = dx < 0 ? -1 : 1;
            }
          }
        }

        s.x = clamp(s.x, 3, 97);
        s.y = clamp(s.y, 30, 96);

        // ── Frame stepping ──
        const dragging = s.state === 'drag';
        const fighting = s.state === 'fight';
        const falling = s.state === 'drop';
        const droopy = energy < 0.3 && (s.state === 'idle' || s.state === 'walk');
        if (s.state === 'action' || s.state === 'faint') {
          // Play once, then resume wandering.
          s.frameAcc += dtMs;
          if (s.frameAcc >= 75) {
            s.frameAcc = 0; s.frame += 1;
            if (s.frame >= frameCount(species, s.anim)) { toIdle(s, now); s.anim = idleAnimFor(pet); s.frame = 0; }
          }
        } else {
          const frameMs = fighting ? 52 : falling ? 60 : (s.state === 'walk' || dragging) ? 65 : lerp(210, 95, energy);
          s.frameAcc += dtMs;
          if (s.frameAcc >= frameMs) {
            s.frameAcc = 0;
            s.frame = (s.frame + 1) % frameCount(species, s.anim);
          }
        }
        const src = framePath(species, pet.style, s.anim, s.frame);
        if (src !== s.lastSrc) { img.src = src; s.lastSrc = src; }

        // ── Render transforms (inline so they survive React re-renders) ──
        const size = clamp(rect.height * BASE_FRACTION * (pet.size_scale || 1), 40, rect.height * 0.62);
        anchor.style.height = `${size}px`;
        const px = (s.x / 100) * rect.width;
        const py = (s.y / 100) * rect.height;
        const lift = dragging ? 1.14 : 1;
        const wob = dragging ? Math.sin(now / 90) * 5 : 0;
        anchor.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%) scale(${lift}) rotate(${wob}deg)`;
        anchor.style.zIndex = dragging || falling ? 9999 : Math.round(s.y * 10);
        anchor.style.filter = dragging ? 'drop-shadow(0 14px 12px rgba(0,0,0,0.45))' : 'none';
        anchor.style.cursor = dragging ? 'grabbing' : 'grab';

        const sx = s.facing < 0 ? -1 : 1;
        let ty = 0, sy = 1, rot = 0;
        if (fighting) { rot = Math.sin(now / 45) * 5; ty = Math.sin(now / 60) * 2; }
        else if (falling) { rot = Math.sin(now / 45) * 16; }
        else if (droopy) { sy = 0.95; ty = 2; }
        else if (s.state === 'walk') { ty = Math.sin(now / 90) * 1.5; }
        else if (energy > 0.75 && s.state === 'idle') { ty = Math.sin(now / 150) * 1.3; }
        img.style.transform = `translateY(${ty}px) scale(${sx}, ${sy}) rotate(${rot}deg)`;
        img.style.filter = droopy ? 'brightness(0.9) saturate(0.85)' : 'none';

        const spark = sparks.current[id];
        if (spark) spark.style.opacity = fighting ? '1' : '0';
      });
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Preload all frames for the shown pets (only when the species/style set
  // actually changes), eliminating decode flicker when animations switch.
  const preloadKey = pets.map(p => `${p.species}:${p.style}`).join('|');
  const lastPreload = useRef('');
  useEffect(() => {
    if (lastPreload.current === preloadKey) return;
    lastPreload.current = preloadKey;
    pets.forEach(p => preloadPet(p.species, p.style));
  }, [pets, preloadKey]);

  // Play a one-shot animation on a specific pet (the Pets-page action picker).
  useEffect(() => {
    if (!oneShot || !oneShot.petId || !oneShot.anim) return;
    const s = sim.current.P[oneShot.petId];
    if (s) { s.state = 'action'; s.actionAnim = oneShot.anim; s.frame = 0; s.frameAcc = 0; }
  }, [oneShot?.key, oneShot?.petId, oneShot?.anim]);

  // ── Pointer: click to focus, drag to move / separate fighters ──
  useEffect(() => {
    const onMove = (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (!d.moved && hyp(dx, dy) > DRAG_THRESHOLD) {
        d.moved = true;
        const s = sim.current.P[d.id];
        if (s) { d.wasFighting = s.state === 'fight'; d.partner = s.partner; s.state = 'drag'; }
      }
      if (d.moved) {
        const s = sim.current.P[d.id];
        if (s) { const p = stagePct(e.clientX, e.clientY); s.x = p.x; s.y = p.y; }
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const s = sim.current.P[d.id];
      if (!s) return;
      const now = performance.now();
      if (!d.moved) { onFocus?.(d.id); return; }   // a click, not a drag → focus

      // Released after a drag → gravity drop into the walking area.
      let faint = false;
      if (d.wasFighting && d.partner && sim.current.P[d.partner]) {
        const p = sim.current.P[d.partner];
        const dist = hyp(p.x - s.x, p.y - s.y);
        if (dist > BREAK_DIST) {
          // Dragged far enough — the scrap is broken up; the loser faints.
          p.state = 'idle'; p.partner = null; p.decisionAt = now + rand(400, 1000);
          faint = true;
        } else {
          // Dropped right back on top of the other — they keep brawling.
          const cx = (s.x + p.x) / 2, cy = Math.max(s.y, p.y);
          const sLeft = s.x <= p.x;
          s.state = p.state = 'fight';
          s.fx = cx + (sLeft ? -FIGHT_GAP : FIGHT_GAP); s.fy = cy;
          p.fx = cx + (sLeft ? FIGHT_GAP : -FIGHT_GAP); p.fy = cy;
          s.fightUntil = p.fightUntil = now + rand(6000, 13000);
          s.loserId = p.loserId = Math.random() < 0.5 ? s.id : p.id;
          return;
        }
      }
      // Gravity drop into the walking area (faints if it was pulled from a fight).
      s.state = 'drop';
      s.vy = 0;
      s.faintOnLand = faint;
      s.landingY = clamp(Math.max(s.y + 4, rand(FLOOR_MIN, 94)), 45, 95);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onFocus, stagePct]);

  const onDown = (e, id) => {
    e.preventDefault();
    drag.current = { id, startX: e.clientX, startY: e.clientY, moved: false, wasFighting: false, partner: null };
  };

  return (
    <div
      className={`pet-env-stage ${compact ? 'pet-env-stage-compact' : ''}`}
      ref={stageRef}
      style={{
        ...(aspectRatio ? { aspectRatio, width: '100%', height: 'auto' } : { height }),
        ...(backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : {}),
      }}
    >
      {pets.map(p => (
        <div
          key={p.id}
          className={`pet-env-sprite ${p.id === focusedId ? 'pet-env-sprite-focused' : ''}`}
          ref={el => setAnchor(p.id, el)}
          onPointerDown={e => onDown(e, p.id)}
          title={`${p.name} · click to focus`}
        >
          {p.id === activeId && <div className="pet-env-crown" title="Active pet — earns XP & shows in the nav">👑</div>}
          <span className={`pet-env-nameplate ${p.id === activeId ? 'pet-env-nameplate-active' : ''}`}>{p.name}</span>
          <div className="pet-env-spark" ref={el => setSpark(p.id, el)}>💥</div>
          <img
            className="pet-env-img"
            ref={el => setImg(p.id, el)}
            src={framePath(p.species, p.style, idleAnimFor(p), 0)}
            alt=""
            decoding="sync"
            draggable={false}
          />
        </div>
      ))}

      {!compact && (
        <div className="pet-env-hint">Click a pet to focus · drag fighting pets apart</div>
      )}
    </div>
  );
}
