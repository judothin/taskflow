import React, { useEffect, useRef, useState, useCallback } from 'react';
import { DEFAULT_WALK_AREA, isValidWalkArea } from '../lib/petLogic';
import './WalkAreaEditor.css';

const MIN_SIZE = 80;

function clampBox(b, stageW, stageH) {
  let { x, y, w, h } = b;
  w = Math.max(MIN_SIZE, Math.min(w, stageW));
  h = Math.max(MIN_SIZE, Math.min(h, stageH));
  x = Math.max(0, Math.min(x, stageW - w));
  y = Math.max(0, Math.min(y, stageH - h));
  return { x, y, w, h };
}

// An overlay (meant to sit inside the same relatively-positioned stage as
// PetSprite) showing a draggable, corner-resizable box representing where a
// pet is allowed to wander. Fractions (0–1 of the stage) in, fractions out.
export default function WalkAreaEditor({ initial, onSave, onCancel }) {
  const containerRef = useRef(null);
  const [box, setBox] = useState(null);
  const dragRef = useRef(null);
  const didInit = useRef(false);

  // Seed the box from `initial` exactly once. `initial` is a fresh object
  // reference every time the app's pet data refreshes in the background
  // (feed/water/rename/XP ticks etc.) — without this guard, any refresh
  // while the editor is open would silently reset a drag/resize in progress.
  useEffect(() => {
    if (!containerRef.current || didInit.current) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    if (!w || !h) return; // not laid out yet — retry next render
    didInit.current = true;
    const init = isValidWalkArea(initial) ? initial : DEFAULT_WALK_AREA;
    setBox(clampBox({ x: init.x * w, y: init.y * h, w: init.w * w, h: init.h * h }, w, h));
  }, [initial]);

  const onMouseMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || !containerRef.current) return;
    const stageW = containerRef.current.clientWidth;
    const stageH = containerRef.current.clientHeight;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.mode === 'move') {
      setBox(clampBox({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, stageW, stageH));
    } else {
      let { x, y, w, h } = d.start;
      if (d.corner.includes('e')) w = d.start.w + dx;
      if (d.corner.includes('s')) h = d.start.h + dy;
      if (d.corner.includes('w')) { w = d.start.w - dx; x = d.start.x + dx; }
      if (d.corner.includes('n')) { h = d.start.h - dy; y = d.start.y + dy; }
      setBox(clampBox({ x, y, w, h }, stageW, stageH));
    }
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove, onMouseUp]);

  const startDragMove = (e) => {
    e.preventDefault();
    dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, start: { ...box } };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const startResize = (corner) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode: 'resize', corner, startX: e.clientX, startY: e.clientY, start: { ...box } };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleSave = () => {
    if (!box || !containerRef.current) return;
    const stageW = containerRef.current.clientWidth;
    const stageH = containerRef.current.clientHeight;
    if (!stageW || !stageH) return; // avoid saving garbage from a divide-by-zero
    const frac = {
      x: Math.min(1, Math.max(0, box.x / stageW)),
      y: Math.min(1, Math.max(0, box.y / stageH)),
      w: Math.min(1, Math.max(0, box.w / stageW)),
      h: Math.min(1, Math.max(0, box.h / stageH)),
    };
    onSave(frac);
  };

  return (
    <div ref={containerRef} className="walk-area-editor">
      {box && (
        <div
          className="walk-area-box"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          onMouseDown={startDragMove}
        >
          {['nw', 'ne', 'sw', 'se'].map(corner => (
            <div key={corner} className={`walk-area-handle walk-area-handle-${corner}`} onMouseDown={startResize(corner)} />
          ))}
        </div>
      )}
      <div className="walk-area-editor-toolbar">
        <span className="walk-area-editor-hint">Drag to move, corners to resize</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>Save Area</button>
      </div>
    </div>
  );
}
