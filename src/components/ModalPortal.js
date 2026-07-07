import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into a dedicated node appended to <body>, escaping any
 * ancestor stacking context or CSS transform/filter that would otherwise
 * re-anchor a `position: fixed` overlay to the card it lives in (which breaks
 * both centering and z-index layering). Every modal in the app should render
 * through this so `.modal-overlay` is always positioned against the viewport.
 */
export default function ModalPortal({ children }) {
  const elRef = useRef(null);

  if (!elRef.current) {
    elRef.current = document.createElement('div');
    elRef.current.className = 'modal-portal';
  }

  useEffect(() => {
    const el = elRef.current;
    document.body.appendChild(el);
    // Prevent the page behind the modal from scrolling while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  return createPortal(children, elRef.current);
}
