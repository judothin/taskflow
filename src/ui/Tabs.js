import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Underline tabs with a count chip. The underline slides between tabs.
 *   <Tabs value={tab} onChange={setTab}
 *     items={[{ value: 'mine', label: 'Waiting on me', count: 7 }, …]} />
 */
export default function Tabs({ items, value, onChange, className = '' }) {
  const wrap = useRef(null);
  const [ink, setInk] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector('.tab.is-on');
    if (!el) { setInk(null); return undefined; }
    const measure = () => setInk({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, items]);

  return (
    <div ref={wrap} className={`tabs ${className}`} role="tablist">
      {items.map(it => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          className={`tab ${value === it.value ? 'is-on' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count != null && <span key={it.count} className="tab-count bump">{it.count}</span>}
        </button>
      ))}
      {ink && <span className="tabs-ink" style={{ width: ink.w, transform: `translateX(${ink.x}px)` }} />}
    </div>
  );
}
