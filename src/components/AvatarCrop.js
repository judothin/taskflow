import React, { useState, useRef, useCallback, useEffect } from 'react';
import ModalPortal from './ModalPortal';

/**
 * AvatarCrop
 * Presents a circular crop UI over an image, returns a cropped Blob.
 *
 * Props:
 *   src       – object URL of the source image
 *   onConfirm(blob) – called with the cropped JPEG blob
 *   onCancel  – called when dismissed
 */
export default function AvatarCrop({ src, onConfirm, onCancel }) {
  const canvasRef   = useRef(null);
  const imgRef      = useRef(null);
  const containerRef = useRef(null);

  const [scale,    setScale]    = useState(1);
  const [offset,   setOffset]   = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart  = useRef(null);

  const SIZE = 280; // crop circle diameter in px

  // Draw the image + crop overlay onto the canvas preview
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    canvas.width  = SIZE;
    canvas.height = SIZE;

    // How the image fits: fill the circle, centered
    const aspect = img.naturalWidth / img.naturalHeight;
    let baseW, baseH;
    if (aspect >= 1) {
      baseH = SIZE;
      baseW = SIZE * aspect;
    } else {
      baseW = SIZE;
      baseH = SIZE / aspect;
    }

    const w = baseW * scale;
    const h = baseH * scale;
    const x = (SIZE - w) / 2 + offset.x;
    const y = (SIZE - h) / 2 + offset.y;

    // Clear
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Dark dimming outside circle
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Clip to circle, draw image
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Circle border
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }, [scale, offset]);

  useEffect(() => { draw(); }, [draw]);

  // ── Drag ────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = {
      mx: e.clientX, my: e.clientY,
      ox: offset.x,  oy: offset.y,
    };
  };

  const onMouseMove = useCallback((e) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(false), []);

  // Touch equivalents
  const onTouchStart = (e) => {
    const t = e.touches[0];
    setDragging(true);
    dragStart.current = { mx: t.clientX, my: t.clientY, ox: offset.x, oy: offset.y };
  };
  const onTouchMove = useCallback((e) => {
    if (!dragging || !dragStart.current) return;
    const t = e.touches[0];
    setOffset({
      x: dragStart.current.ox + t.clientX - dragStart.current.mx,
      y: dragStart.current.oy + t.clientY - dragStart.current.my,
    });
  }, [dragging]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend',  onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend',  onMouseUp);
    };
  }, [onMouseMove, onMouseUp, onTouchMove]);

  // ── Confirm: render final cropped circle to a new canvas & export ──
  const handleConfirm = () => {
    const img    = imgRef.current;
    if (!img) return;

    const out    = document.createElement('canvas');
    out.width    = SIZE;
    out.height   = SIZE;
    const ctx    = out.getContext('2d');

    const aspect = img.naturalWidth / img.naturalHeight;
    let baseW, baseH;
    if (aspect >= 1) { baseH = SIZE; baseW = SIZE * aspect; }
    else             { baseW = SIZE; baseH = SIZE / aspect; }

    const w = baseW * scale;
    const h = baseH * scale;
    const x = (SIZE - w) / 2 + offset.x;
    const y = (SIZE - h) / 2 + offset.y;

    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);

    out.toBlob((blob) => { onConfirm(blob); }, 'image/jpeg', 0.92);
  };

  return (
    <ModalPortal>
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Crop Profile Photo</h2>
          <button onClick={onCancel} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', alignSelf: 'flex-start' }}>
            Drag to reposition · scroll or use the slider to zoom
          </p>

          {/* Hidden img element used as source for canvas */}
          <img
            ref={imgRef}
            src={src}
            alt=""
            style={{ display: 'none' }}
            onLoad={draw}
          />

          {/* Canvas crop preview */}
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            style={{
              borderRadius: '50%',
              cursor: dragging ? 'grabbing' : 'grab',
              userSelect: 'none',
              touchAction: 'none',
              width: SIZE,
              height: SIZE,
            }}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
          />

          {/* Zoom slider */}
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.01"
              value={scale}
              onChange={e => setScale(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button onClick={handleConfirm} className="btn btn-primary">Apply</button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
