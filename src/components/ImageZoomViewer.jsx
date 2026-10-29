// Full-screen zoom for a picked proof image, so the user can double-check it
// before submitting. Mounted once in App: tapping any proof preview
// (img.proof-preview / img.xm-proof-img) in any modal opens it.
//   zoom: + / − buttons, mouse wheel, pinch, double-tap (1× ↔ 2.5×)
//   pan:  drag while zoomed in        close: X, Esc, tap outside the image
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import './ImageZoomViewer.css';

const ZOOMABLE = 'img.proof-preview, img.xm-proof-img';
const MIN = 1;
const MAX = 5;
const clamp = (v) => Math.min(MAX, Math.max(MIN, v));

function Viewer({ src, alt, onClose }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const gesture = useRef(null);   // { startDist, startScale } | { startX, startY, x, y }
  const moved = useRef(false);
  const lastTap = useRef(0);

  const zoomTo = useCallback((scale) => {
    setView(v => {
      const s = clamp(scale);
      return s === 1 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: s };
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') setView(v => ({ ...v, scale: clamp(v.scale + 0.5) }));
      else if (e.key === '-') zoomTo(view.scale - 0.5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomTo, view.scale]);

  const onWheel = (e) => zoomTo(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), startScale: view.scale };
    } else if (pts.length === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, x: view.x, y: view.y };
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (!g) return;
    if (pts.length === 2 && g.startDist) {
      moved.current = true;
      zoomTo(g.startScale * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.startDist));
    } else if (pts.length === 1 && g.startX !== undefined && view.scale > 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      setView(v => ({ ...v, x: g.x + dx / v.scale, y: g.y + dy / v.scale }));
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const rest = [...pointers.current.values()];
    gesture.current = rest.length === 1 ? { startX: rest[0].x, startY: rest[0].y, x: view.x, y: view.y } : null;
  };

  const onImageClick = (e) => {
    e.stopPropagation();
    if (moved.current) return;
    const now = Date.now();
    if (now - lastTap.current < 300) { zoomTo(view.scale > 1 ? 1 : 2.5); lastTap.current = 0; }
    else lastTap.current = now;
  };

  return (
    <div className="izv-overlay" role="dialog" aria-modal="true" aria-label="Image preview" onClick={() => { if (!moved.current) onClose(); }}>
      <button type="button" className="izv-close" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <X size={22} />
      </button>

      <div
        className="izv-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={src}
          alt={alt || 'Proof'}
          className="izv-img"
          draggable={false}
          onClick={onImageClick}
          style={{
            transform: `scale(${view.scale}) translate(${view.x}px, ${view.y}px)`,
            cursor: view.scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>

      <div className="izv-controls" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom out" disabled={view.scale <= MIN} onClick={() => zoomTo(view.scale - 0.5)}><ZoomOut size={18} /></button>
        <span className="izv-level">{Math.round(view.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={view.scale >= MAX} onClick={() => zoomTo(view.scale + 0.5)}><ZoomIn size={18} /></button>
        <button type="button" aria-label="Reset zoom" disabled={view.scale === 1} onClick={() => zoomTo(1)}><RotateCcw size={16} /></button>
      </div>
    </div>
  );
}

export default function ImageZoomHost() {
  const [image, setImage] = useState(null);   // { src, alt }

  useEffect(() => {
    const onClick = (e) => {
      const img = e.target.closest?.(ZOOMABLE);
      if (!img || !img.src) return;
      e.preventDefault();
      e.stopPropagation();
      setImage({ src: img.src, alt: img.alt });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  if (!image) return null;
  return createPortal(<Viewer src={image.src} alt={image.alt} onClose={() => setImage(null)} />, document.body);
}
