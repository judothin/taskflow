import React from 'react';

/**
 * Shows a profile image if `src` is set, otherwise falls back to a
 * coloured circle with `initials`.
 */
export default function Avatar({ src, color = '#6366f1', initials = '?', size = 36, style = {} }) {
  const base = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    ...style,
  };

  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ ...base, objectFit: 'cover', display: 'block' }}
        onError={e => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }

  return (
    <div
      style={{
        ...base,
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 700,
        color: 'white',
      }}
    >
      {initials}
    </div>
  );
}
