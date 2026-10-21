import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/**
 * A dropdown anchored to a button. Renders in a portal at fixed position,
 * flips above the anchor when there's no room below, closes on outside
 * click / Escape / item click.
 *
 *   const menu = useMenu();
 *   <button ref={menu.anchorRef} onClick={menu.toggle}>…</button>
 *   <Menu {...menu.props} align="end">
 *     <MenuItem icon="edit" onClick={…}>Edit</MenuItem>
 *   </Menu>
 */
export function useMenu() {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen(o => !o), []);
  return { anchorRef, open, setOpen, close, toggle, props: { anchorRef, open, onClose: close } };
}

export function Menu({ anchorRef, open, onClose, align = 'start', width, children, className = '' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const m = ref.current;
      if (!a || !m) return;
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const below = a.bottom + 6;
      const up = below + h > vh - 8 && a.top - h - 6 > 8;
      const top = up ? a.top - h - 6 : Math.min(below, vh - h - 8);
      setPos({ left, top, up, origin: `${align === 'end' ? 'right' : 'left'} ${up ? 'bottom' : 'top'}` });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`menu ${pos?.up ? 'is-up' : ''} ${className}`}
      role="menu"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        '--origin': pos?.origin,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={(e) => { if (e.target.closest('[data-menu-close]')) onClose?.(); }}
    >
      {children}
    </div>,
    document.body
  );
}

export function MenuItem({ icon, children, onClick, danger, checked, kbd, disabled, keepOpen }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? 'is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...(keepOpen ? {} : { 'data-menu-close': '' })}
    >
      {icon && <Icon name={icon} size={15} />}
      <span className="truncate" style={{ flex: 1 }}>{children}</span>
      {kbd && <span className="kbd-box">{kbd}</span>}
      {checked && <Icon name="check" size={14} className="menu-check" />}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" />;
export const MenuLabel = ({ children }) => <div className="menu-label">{children}</div>;
