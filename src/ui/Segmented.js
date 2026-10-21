import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * Segmented bar. The selected cell is filled with the accent, and the fill
 * slides (with a little spring) to the next choice instead of jumping.
 *   <Segmented value={roi} onChange={setRoi}
 *     options={[{ value: 'low', label: 'Low' }, …]} />
 */
export default function Segmented({ options, value, onChange, size, className = '', ariaLabel }) {
  const wrap = useRef(null);
  const [thumb, setThumb] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector('.seg-btn.is-on');
    if (!el) { setThumb(null); return undefined; }
    const measure = () => setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div ref={wrap} className={`seg ${size === 'sm' ? 'seg-sm' : ''} ${className}`} role="radiogroup" aria-label={ariaLabel}>
      {thumb && (
        <span className="seg-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} aria-hidden="true" />
      )}
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg-btn ${value === o.value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
