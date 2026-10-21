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

export function Menu({ anchorRef, open, onClose, align = 'start', width, point, children, className = '' }) {
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
      // clientWidth excludes the scrollbar, so right-anchored menus sit
      // exactly under their button.
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      if (point) {
        // Context menu: open at the cursor, growing away from it. Flip left
        // or up when there's no room, and grow out of the corner nearest the
        // cursor so it reads as coming from where you clicked.
        const gap = 2;
        const left = point.x + gap + w > vw - 8 ? Math.max(8, point.x - gap - w) : point.x + gap;
        let top = point.y + gap;
        let up = false;
        if (top + h > vh - 8) {
          if (point.y - gap - h >= 8) { top = point.y - gap - h; up = true; } else top = Math.max(8, vh - h - 8);
        }
        const ox = Math.min(w, Math.max(0, point.x - left));
        const oy = Math.min(h, Math.max(0, point.y - top));
        setPos({ left, top, up, origin: `${ox}px ${oy}px` });
        return;
      }
      const below = a.bottom + 6;
      const up = below + h > vh - 8 && a.top - h - 6 > 8;
      const top = up ? a.top - h - 6 : Math.max(8, Math.min(below, vh - h - 8));
      const origin = `${align === 'end' ? 'right' : 'left'} ${up ? 'bottom' : 'top'}`;
      if (align === 'end') {
        // Pin the right edge to the anchor's right edge, so the menu hangs
        // under its button whatever width it ends up rendering at.
        const right = Math.max(8, Math.min(vw - a.right, vw - w - 8));
        setPos({ right, top, up, origin });
      } else {
        const left = Math.max(8, Math.min(a.left, vw - w - 8));
        setPos({ left, top, up, origin });
      }
    };
    place();
    // Re-place once layout settles (fonts, async content in the menu).
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, align, point]);

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
        left: pos ? pos.left : -9999,
        right: pos ? pos.right : undefined,
        top: pos ? pos.top : -9999,
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
