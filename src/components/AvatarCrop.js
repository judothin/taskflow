import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, Icon } from '../ui';
import { Range } from './SettingsControls';

/**
 * Circular crop for a profile photo. Drag to move, scroll / pinch-free
 * slider to zoom; returns a JPEG blob.
 *   <AvatarCrop src={objectUrl} onConfirm={(blob) => …} onCancel={…} />
 */
const SIZE = 280; // output & canvas size in px

function layout(img, scale, offset) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const baseW = aspect >= 1 ? SIZE * aspect : SIZE;
  const baseH = aspect >= 1 ? SIZE : SIZE / aspect;
  const w = baseW * scale;
  const h = baseH * scale;
  return { w, h, x: (SIZE - w) / 2 + offset.x, y: (SIZE - h) / 2 + offset.y };
}

export default function AvatarCrop({ src, onConfirm, onCancel }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    const ctx = canvas.getContext('2d');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const { x, y, w, h } = layout(img, scale, offset);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }, [scale, offset]);

  useEffect(() => { draw(); }, [draw]);

  // Pointer drag — the canvas can be shown smaller than SIZE on a phone, so
  // convert screen pixels to canvas pixels.
  const ratio = () => {
    const r = canvasRef.current?.getBoundingClientRect();
    return r && r.width ? SIZE / r.width : 1;
  };
  const onPointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y, k: ratio() };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.mx) * d.k, y: d.oy + (e.clientY - d.my) * d.k });
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  // Wheel zoom without scrolling the page behind the dialog.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setScale(s => Math.min(3, Math.max(0.5, s - e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const confirm = () => {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = SIZE;
    out.height = SIZE;
    const ctx = out.getContext('2d');
    const { x, y, w, h } = layout(img, scale, offset);
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    out.toBlob((blob) => { if (blob) onConfirm(blob); }, 'image/jpeg', 0.92);
  };

  return (
    <Dialog
      title="Crop your photo"
      text="Drag to reposition. Scroll or use the slider to zoom."
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={!ready}>Use photo</button>
        </>
      )}
    >
      <div className="st-crop">
        <img ref={imgRef} src={src} alt="" hidden onLoad={() => { setReady(true); draw(); }} />
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className={dragging ? 'is-dragging' : ''}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Photo crop area"
        />
        <div className="st-crop-zoom">
          <Icon name="image" size={13} />
          <Range value={scale} min={0.5} max={3} step={0.01} onChange={setScale} label="Zoom" />
          <Icon name="image" size={18} />
        </div>
      </div>
    </Dialog>
  );
}
