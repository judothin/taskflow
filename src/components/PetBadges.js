import React, { useEffect, useState } from 'react';
import { getRankBadges } from '../lib/petBadges';
import './PetBadges.css';

// The rank PNGs come with differing amounts of transparent padding, so their
// visible artwork wouldn't line up if drawn as-is. This trims each image to its
// real (non-transparent) bounding box and re-centres/scales that into a uniform
// square, so every badge's actual emblem aligns perfectly. Result cached by src.
const normCache = new Map();
const pending = new Map();

function normalizeRank(src, cb) {
  if (normCache.has(src)) { cb(normCache.get(src)); return; }
  if (pending.has(src)) { pending.get(src).push(cb); return; }
  pending.set(src, [cb]);
  const finish = (url) => {
    normCache.set(src, url);
    (pending.get(src) || []).forEach(fn => fn(url));
    pending.delete(src);
  };
  const img = new Image();
  img.onload = () => {
    try {
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, 340 / maxDim);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 12) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) { finish(src); return; }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const S = 256, margin = 0.04 * S, avail = S - 2 * margin;
      const k = Math.min(avail / bw, avail / bh);
      const dw = bw * k, dh = bh * k;
      const out = document.createElement('canvas');
      out.width = S; out.height = S;
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(c, minX, minY, bw, bh, (S - dw) / 2, (S - dh) / 2, dw, dh);
      finish(out.toDataURL());
    } catch { finish(src); }
  };
  img.onerror = () => finish(src);
  img.src = src;
}

function RankImage({ src, size }) {
  const [url, setUrl] = useState(() => normCache.get(src) || null);
  useEffect(() => {
    let live = true;
    setUrl(normCache.get(src) || null);
    normalizeRank(src, (u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [src]);
  return (
    <img
      className="rank-img"
      src={url || src}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{ visibility: url ? 'visible' : 'hidden' }}
    />
  );
}

// User ranks.
//  compact  — the top-bar strip. `shown` (array of keys) picks which earned
//             badges appear; if null, auto-shows the highest earned per track.
//  full     — every rank grouped by Level / Age / Tasks (the Settings view).
//             With `selectable`, earned badges get a checkbox (checked when in
//             `selected`) and clicking calls `onToggle(key)`.
export default function RankBadges({
  level, createdAt, tasksDone = 0, specialFlags = {},
  compact = false, allEarned = false, size = 46, labels = false, title,
  shown = null, selectable = false, selected = [], onToggle,
}) {
  const { levelBadges, ageBadges, taskBadges, specialBadges, earnedCount, total } =
    getRankBadges(level, createdAt, tasksDone, specialFlags);

  if (compact) {
    const earnedAll = [...levelBadges, ...taskBadges, ...ageBadges, ...specialBadges].filter(b => b.earned);
    let show;
    if (allEarned) {
      show = earnedAll;
    } else if (Array.isArray(shown)) {
      show = earnedAll.filter(b => shown.includes(b.key));
    } else {
      const topLevel = [...levelBadges].reverse().find(b => b.earned);
      const topAge = [...ageBadges].reverse().find(b => b.earned);
      const topTask = [...taskBadges].reverse().find(b => b.earned);
      const special = specialBadges.filter(b => b.earned);
      show = [topLevel, topAge, topTask, ...special].filter(Boolean);
    }
    if (!show.length) return null;
    return (
      <div className="pet-badges-compact">
        {title && <div className="sidebar-ranks-title">{title}</div>}
        <div className="pet-badges-strip">
          {show.map(b => (
            <div key={b.key} className="pet-badge earned" title={`${b.name} · ${b.req}`}>
              <RankImage src={b.img} size={size} />
              {labels && <div className="pet-badge-name">{b.name}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const section = (label, list) => (
    <div className="pet-badges-section">
      <div className="pet-badges-sub">{label}</div>
      <div className="pet-badges-grid">
        {list.map(b => {
          const checked = selected.includes(b.key);
          const canSelect = selectable && b.earned;
          return (
            <div
              key={b.key}
              className={`pet-badge ${b.earned ? 'earned' : 'locked'} ${canSelect ? 'selectable' : ''} ${canSelect && checked ? 'shown' : ''}`}
              title={b.earned ? (canSelect ? `${b.name} — click to ${checked ? 'hide' : 'show'} in top bar` : `${b.name} — earned`) : `Locked · reach ${b.req}`}
              onClick={canSelect ? () => onToggle?.(b.key) : undefined}
            >
              <div className="pet-badge-art">
                <RankImage src={b.img} size={76} />
                {!b.earned && <span className="pet-badge-lock">🔒</span>}
                {canSelect && (
                  <span className={`pet-badge-check ${checked ? 'on' : ''}`}>
                    {checked && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </span>
                )}
              </div>
              <div className="pet-badge-name">{b.name}</div>
              {!b.earned && b.target ? (
                <div className="pet-badge-progress">
                  <div className="pet-badge-progress-track">
                    <div
                      className="pet-badge-progress-fill"
                      style={{ width: `${Math.min(100, Math.round((b.cur / b.target) * 100))}%` }}
                    />
                  </div>
                  <div className="pet-badge-req">{Math.min(b.cur, b.target)}/{b.target}{b.unit}</div>
                </div>
              ) : (
                <div className="pet-badge-req">{b.req}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="pet-badges">
      <div className="pet-badges-count">{earnedCount} of {total} earned</div>
      {section('Level', levelBadges)}
      {section('Tasks', taskBadges)}
      {section('Age', ageBadges)}
      {section('Special', specialBadges)}
    </div>
  );
}
