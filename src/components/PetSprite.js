import React, { useEffect, useRef, useState } from 'react';
import { framePath, frameCount } from '../lib/petSpecies';
import { DEFAULT_WALK_AREA, isValidWalkArea } from '../lib/petLogic';
import { getSavedPosition, savePosition } from '../lib/petPositionStore';
import './PetSprite.css';

// Frame-stepping rate for the sprite's <img src> swap (walking/idle cycle).
// This was throttled down to 6fps as a mitigation while chasing the
// backdrop-filter tearing bug — that bug's actual fix (removing
// backdrop-filter entirely; see index.css's #tf-bg-layer) made the
// throttle unnecessary, and it had a real cost: some animations (e.g.
// golem's walk cycle, which bounces the character up/down more per frame
// than wraith's) looked choppy/glitchy at 6fps instead of smooth. Back to
// the original rate. Still overridable per-instance via the `fps` prop.
const FPS = 10;
const WALK_SPEED_PCT_S = 12; // % of stage size, per second
const ARRIVE_THRESHOLD_PCT = 2;
const IDLE_MIN_MS = 2000;
const IDLE_MAX_MS = 5000;

const randRange = (a, b) => a + Math.random() * (b - a);

// Renders one pet's current animation frame. Position is tracked entirely
// in PERCENTAGES of the stage (0–100), rendered via `left/top: N%` — never
// converted through a JS-measured pixel size for the core movement logic,
// which sidesteps a whole class of bugs where a measured size is stale,
// raced, or doesn't match what's actually laid out (e.g. around
// aspect-ratio sizing). A `ResizeObserver` is used only to compute a small
// inset (see below) — never for the position itself.
//
// When `roam` is true it wanders to random points inside `walkArea` (a
// {x,y,w,h} box, fractions 0–1 of the stage), moving by real elapsed time
// (not an assumed fixed tick) and hard-clamped to 0–100% every frame — it
// cannot end up positioned outside the visible stage. When `roam` is false
// (the sidebar nav slot) it just loops `idleAnimation` in place. Manually
// triggered actions interrupt either mode, play once, then it resumes.
export default function PetSprite({
  species, style, size = 96, dead = false, action = null, onActionDone,
  idleAnimation = 'idle', roam = true, walkArea, className = '', fps = FPS, petId,
}) {
  const tickMs = 1000 / fps;
  const containerRef = useRef(null);
  const engine = useRef({
    anim: idleAnimation, frame: 0,
    xPct: null, yPct: null, targetXPct: 0, targetYPct: 0,
    facing: 1, phaseUntil: 0, oneShot: null, transitionMs: 0,
  });
  const [, setTick] = useState(0);
  // Only used to inset the wander box by the sprite's own on-screen
  // footprint, so the visible character stays inside the drawn box instead
  // of just its anchor point (which sits at the sprite's own bottom-center).
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setStageSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (action) engine.current.oneShot = { anim: action, frame: 0 };
  }, [action]);

  useEffect(() => {
    engine.current.idleAnimDefault = idleAnimation;
  }, [idleAnimation]);

  // Preload every frame of the two continuously-cycling animations (idle +
  // walking) so the per-tick <img src> swap always hits an already-decoded
  // image instead of triggering a fresh decode — a no-behavior-change
  // performance safety net (frames are tiny PNGs, this is cheap).
  useEffect(() => {
    [idleAnimation, 'walking'].forEach(anim => {
      const count = frameCount(species, anim);
      for (let i = 0; i < count; i++) {
        const img = new Image();
        img.src = framePath(species, style, anim, i);
      }
    });
  }, [species, style, idleAnimation]);

  useEffect(() => {
    if (dead) return undefined;

    const box = isValidWalkArea(walkArea) ? walkArea : DEFAULT_WALK_AREA;
    const nominalX = Math.min(Math.max(0, box.x * 100), 100);
    const nominalY = Math.min(Math.max(0, box.y * 100), 100);
    const nominalW = Math.max(10, Math.min(box.w * 100, 100 - nominalX));
    const nominalH = Math.max(10, Math.min(box.h * 100, 100 - nominalY));

    // Inset the usable area by (roughly) the sprite's own rendered size, in
    // percentage terms — half its width on the left/right (it's centered on
    // its anchor), and its full height on top (it extends upward from the
    // bottom-anchored point; no inset needed on the bottom, since the
    // anchor *is* the sprite's bottom edge).
    // Capped at 55% of the box's own height (not ~100%) — for a short,
    // shallow box (a wide "floor" band, the common case) a full sprite-height
    // inset could eat nearly the whole box, leaving almost no vertical room
    // to wander and making movement look like it's only ever side-to-side.
    // Better to let a very short box allow slight sprite overflow than to
    // kill vertical movement entirely.
    const insetX = stageSize.w > 0 ? Math.min(nominalW / 2 - 1, ((size * 0.4) / stageSize.w) * 100) : 0;
    const insetYTop = stageSize.h > 0 ? Math.min(nominalH * 0.55, (size / stageSize.h) * 100) : 0;

    const areaX = nominalX + insetX;
    const areaW = Math.max(1, nominalW - insetX * 2);
    const areaY = nominalY + insetYTop;
    const areaH = Math.max(1, nominalH - insetYTop);

    const e = engine.current;
    if (e.xPct == null || !Number.isFinite(e.xPct) || !Number.isFinite(e.yPct)) {
      // Fresh mount (e.g. navigated back to a page that unmounted this
      // sprite) — restore wherever it last was instead of snapping back to
      // center, if we have a remembered spot for this pet.
      const saved = getSavedPosition(petId);
      if (saved && Number.isFinite(saved.xPct) && Number.isFinite(saved.yPct)) {
        e.xPct = saved.xPct;
        e.yPct = saved.yPct;
      } else {
        e.xPct = areaX + areaW / 2;
        e.yPct = areaY + areaH;
      }
    }
    // Always clamp into the (possibly just-changed, or just-restored) box.
    e.xPct = Math.min(Math.max(e.xPct, areaX), areaX + areaW);
    e.yPct = Math.min(Math.max(e.yPct, areaY), areaY + areaH);

    const pickTarget = () => {
      e.targetXPct = areaX + Math.random() * areaW;
      e.targetYPct = areaY + Math.random() * areaH;
    };

    if (e.phaseUntil === 0) {
      e.anim = e.idleAnimDefault || 'idle';
      e.phaseUntil = performance.now() + randRange(IDLE_MIN_MS, IDLE_MAX_MS);
      e.transitionMs = 0;
    }

    // Driven by requestAnimationFrame (throttled to ~FPS internally) rather
    // than setInterval — rAF is scheduled in step with the browser's own
    // paint cycle, so it doesn't fight with scroll/compositing the way an
    // independent timer can (that mismatch is what caused the scroll-time
    // flicker/tearing elsewhere on the page).
    //
    // Movement itself is a CSS transition, not a per-frame position step.
    // The old version recomputed xPct/yPct and wrote a new `transform`
    // every tick (~6-10x/sec, forever) — confirmed via testing that this
    // continuous DOM/style write, combined with `backdrop-filter` blur
    // ANYWHERE on the page (glassmorphism background mode), causes real
    // compositor tearing. It wasn't the transform vs left/top choice, and
    // it wasn't any one specific blurred element — freezing the animation
    // entirely was the only thing that stopped it, which meant the fix had
    // to be about *how often* position actually changes, not sacrificing
    // the blur look. Now, when a walk phase starts, the TARGET position is
    // written once with a matching `transition-duration`, and the browser's
    // compositor interpolates the motion on its own — no JS/React/DOM work
    // during the walk itself. Only sprite-frame stepping (~6fps, an <img>
    // src swap) still runs continuously; that alone hasn't shown the same
    // tearing in testing.
    let rafId;
    let lastFrameAt = 0;

    const tick = (now) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastFrameAt < tickMs) return;
      lastFrameAt = now;

      if (e.oneShot) {
        const count = frameCount(species, e.oneShot.anim);
        e.oneShot.frame += 1;
        if (e.oneShot.frame >= count) {
          const done = onActionDone;
          e.oneShot = null;
          e.phaseUntil = 0;
          if (done) done();
        } else {
          e.anim = e.oneShot.anim;
          e.frame = e.oneShot.frame;
          setTick(t => t + 1);
          return;
        }
      }

      if (!roam) {
        e.anim = e.idleAnimDefault || 'idle';
        const count = frameCount(species, e.anim);
        e.frame = (e.frame + 1) % count;
        setTick(t => t + 1);
        return;
      }

      if (now > e.phaseUntil) {
        if (e.anim === 'walking' || e.phaseUntil === 0) {
          // Arriving at idle — the CSS transition has visually landed the
          // sprite at targetXPct/targetYPct by now (phaseUntil was set to
          // exactly the walk's transition duration), so snap the logical
          // position to match.
          if (e.phaseUntil !== 0) { e.xPct = e.targetXPct; e.yPct = e.targetYPct; }
          e.anim = e.idleAnimDefault || 'idle';
          e.phaseUntil = now + randRange(IDLE_MIN_MS, IDLE_MAX_MS);
          e.transitionMs = 0;
        } else {
          // Re-roll a few times if the random target lands too close to
          // walk to meaningfully — committing to the walking animation for
          // a target that's immediately "arrived" made it play just one
          // frame of the walking pose before snapping back to idle, which
          // for a species whose walk pose looks very different from its
          // idle pose (e.g. golem) reads as a visible pop/flicker.
          let dx, dy, dist;
          let attempts = 0;
          do {
            pickTarget();
            dx = e.targetXPct - e.xPct;
            dy = e.targetYPct - e.yPct;
            dist = Math.hypot(dx, dy);
            attempts += 1;
          } while (dist < ARRIVE_THRESHOLD_PCT && attempts < 5);

          if (dist < ARRIVE_THRESHOLD_PCT) {
            // Still too close after retries (a tiny walk area) — skip this
            // walk phase entirely rather than flash the walking pose.
            e.anim = e.idleAnimDefault || 'idle';
            e.phaseUntil = now + randRange(IDLE_MIN_MS, IDLE_MAX_MS);
            e.transitionMs = 0;
          } else {
            e.anim = 'walking';
            const durationS = Math.max(0.3, dist / WALK_SPEED_PCT_S);
            e.phaseUntil = now + durationS * 1000;
            e.transitionMs = durationS * 1000;
            if (Math.abs(dx) > 0.3) e.facing = dx < 0 ? -1 : 1;
          }
        }
        e.frame = 0;
      }

      const count = frameCount(species, e.anim);
      e.frame = (e.frame + 1) % count;

      setTick(t => t + 1);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      // Remember roughly where the pet was so a remount (navigating away and
      // back) can resume there instead of re-centering. Mid-walk, the exact
      // interpolated position isn't tracked (it's a CSS transition, not a JS
      // value) — the walk's destination is a reasonable approximation.
      savePosition(petId, e.anim === 'walking' ? e.targetXPct : e.xPct, e.anim === 'walking' ? e.targetYPct : e.yPct);
    };
  }, [species, dead, roam, walkArea, onActionDone, size, stageSize.w, stageSize.h, tickMs, petId]);

  const e = engine.current;
  const anim = dead ? 'dying' : e.anim;
  const frame = dead ? frameCount(species, 'dying') - 1 : e.frame;
  const src = framePath(species, style, anim, frame);

  const useStatic = dead || !roam;
  const flip = !useStatic && e.facing < 0;
  // While walking, render the TARGET position with a matching CSS
  // transition duration — the compositor animates the actual movement, so
  // no JS/DOM write happens again until the walk finishes. While idle,
  // render the settled current position with no transition (instant).
  const walking = !useStatic && e.anim === 'walking';
  const displayXPct = walking ? e.targetXPct : e.xPct;
  const displayYPct = walking ? e.targetYPct : e.yPct;
  const posXPct = Number.isFinite(displayXPct) ? displayXPct : 50;
  const posYPct = Number.isFinite(displayYPct) ? displayYPct : 100;

  // Position via `transform: translate3d(...)` in pixels rather than
  // `left/top: N%`. left/top are layout properties — changing them forces
  // the browser to run layout on the main thread, which was contending with
  // the compositor during scroll (confirmed by removing the widget: tearing
  // vanished entirely). A pure `transform` change is composite-only and,
  // combined with `will-change: transform` in the stylesheet, keeps this
  // element on its own GPU layer. `left/top` stay fixed at 0 so they never
  // trigger layout at all.
  //
  // The MOVE (translate3d) and the FLIP (scaleX) live on two separate
  // elements — an outer wrapper that walks, an inner <img> that faces —
  // rather than one combined `transform`. Transitioning a single transform
  // that includes both interpolates scaleX(1) -> scaleX(-1) smoothly, which
  // passes through scaleX(0) at the midpoint and visibly squashes the
  // sprite flat. Keeping the flip un-transitioned on its own element avoids
  // that entirely — it just snaps.
  let wrapStyle;
  if (useStatic) {
    wrapStyle = { left: '50%', bottom: 0, transform: 'translate3d(-50%, 0, 0)' };
  } else if (stageSize.w > 0 && stageSize.h > 0) {
    const px = (posXPct / 100) * stageSize.w;
    const py = (posYPct / 100) * stageSize.h;
    wrapStyle = {
      left: 0, top: 0,
      transform: `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`,
      transition: walking ? `transform ${(e.transitionMs || 0) / 1000}s linear` : 'none',
    };
  } else {
    // Before the ResizeObserver has reported a real size (first paint only).
    wrapStyle = { left: `${posXPct}%`, top: `${posYPct}%`, transform: 'translate(-50%, -100%)' };
  }

  return (
    <div ref={containerRef} className={`pet-sprite-stage ${className}`} style={{ height: '100%' }}>
      <div className="pet-sprite-anchor" style={{ height: size, ...wrapStyle }}>
        <img
          src={src} alt="" className="pet-sprite-img" decoding="sync"
          style={{ height: '100%', transform: `scaleX(${flip ? -1 : 1})` }}
          draggable={false}
        />
      </div>
    </div>
  );
}
