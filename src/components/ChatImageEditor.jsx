import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, PenLine, Type, MoreHorizontal, Crop, SlidersHorizontal, Download, Undo2, Check, Send,
} from 'lucide-react';
import { loadImage, canvasToJpeg } from '../utils/imageCompress';
import './ChatImageEditor.css';

/**
 * Messenger-style photo editor for a chat image that's waiting to be sent.
 *   top-right: Draw · Aa (text) · ⋯ (Crop, Adjust, Save)
 *   bottom:    Done (keep the edits) · Send
 * Edits are kept as data on the ORIGINAL photo (crop window, adjustments,
 * strokes, texts in image pixels), so opening the editor again lets you keep
 * changing them; the result is exported as a JPEG.
 *
 * props:
 *   item     { id, originalUrl, originalFile, edit? }
 *   onCancel ()                      close, nothing changes
 *   onDone   ({ edit, file, url })   keep the edits
 *   onSend   ({ edit, file, url })   keep the edits and send everything
 */

const COLORS = ['#FFFFFF', '#111111', '#E53E3E', '#F6AD55', '#F6E05E', '#48BB78', '#4299E1', '#9F7AEA'];
const MIN_CROP = 40;
const freshEdit = (img) => ({
  crop: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight },
  adjust: { brightness: 100, contrast: 100, saturate: 100 },
  strokes: [],
  texts: [],
});

// Draws the picture through `view` (the crop window, or the whole photo while
// cropping): adjustments → drawing → text.
function paint(ctx, img, edit, view, scale) {
  const { adjust, strokes, texts } = edit;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-view.x, -view.y);
  ctx.filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  strokes.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.01, s.points[0][1]);
    ctx.stroke();
  });
  texts.forEach((t) => {
    ctx.font = `700 ${t.size}px Poppins, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = t.size / 7;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = t.color === '#111111' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  });
  ctx.restore();
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export default function ChatImageEditor({ item, onCancel, onDone, onSend }) {
  const [img, setImg] = useState(null);
  const [edit, setEdit] = useState(null);
  const [mode, setMode] = useState('view');     // view | draw | text | crop | adjust
  const [color, setColor] = useState('#E53E3E');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftCrop, setDraftCrop] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const editBeforeAdjust = useRef(null);

  // load the original photo (and any earlier edits)
  useEffect(() => {
    let alive = true;
    loadImage(item.originalUrl).then((im) => {
      if (!alive) return;
      setImg(im);
      setEdit(item.edit || freshEdit(im));
    });
    return () => { alive = false; };
  }, [item]);

  // fit the canvas to the space between the bars
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // what's on screen: the crop window, or the whole photo while cropping
  const view = useMemo(() => {
    if (!edit || !img) return null;
    return mode === 'crop' ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight } : edit.crop;
  }, [edit, img, mode]);
  const scale = view && stage.w ? Math.min(stage.w / view.w, stage.h / view.h) : 0;

  // redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !edit || !scale) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.w * scale * dpr);
    canvas.height = Math.round(view.h * scale * dpr);
    canvas.style.width = `${view.w * scale}px`;
    canvas.style.height = `${view.h * scale}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w * scale, view.h * scale);
    paint(ctx, img, edit, view, scale);
    if (mode === 'crop' && draftCrop) {
      const c = { x: draftCrop.x * scale, y: draftCrop.y * scale, w: draftCrop.w * scale, h: draftCrop.h * scale };
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, view.w * scale, c.y);
      ctx.fillRect(0, c.y + c.h, view.w * scale, view.h * scale - c.y - c.h);
      ctx.fillRect(0, c.y, c.x, c.h);
      ctx.fillRect(c.x + c.w, c.y, view.w * scale - c.x - c.w, c.h);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.lineWidth = 4;
      [[c.x, c.y, 1, 1], [c.x + c.w, c.y, -1, 1], [c.x, c.y + c.h, 1, -1], [c.x + c.w, c.y + c.h, -1, -1]].forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + 16 * dy);
        ctx.lineTo(x, y);
        ctx.lineTo(x + 16 * dx, y);
        ctx.stroke();
      });
    }
  }, [img, edit, view, scale, mode, draftCrop]);

  const toImage = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [(e.clientX - rect.left) / scale + view.x, (e.clientY - rect.top) / scale + view.y];
  };

  const textAt = (x, y) => [...edit.texts].reverse().find((t) => (
    Math.abs(x - t.x) <= (t.text.length * t.size * 0.32) + 10 && Math.abs(y - t.y) <= t.size * 0.7
  ));

  const onPointerDown = (e) => {
    if (!edit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toImage(e);
    if (mode === 'draw') {
      dragRef.current = { kind: 'draw' };
      setEdit((ed) => ({ ...ed, strokes: [...ed.strokes, { color, width: 5 / scale, points: [[x, y]] }] }));
    } else if (mode === 'crop' && draftCrop) {
      const tol = 22 / scale;
      const c = draftCrop;
      const near = (px, py) => Math.abs(x - px) < tol && Math.abs(y - py) < tol;
      const handle = near(c.x, c.y) ? 'nw' : near(c.x + c.w, c.y) ? 'ne' : near(c.x, c.y + c.h) ? 'sw'
        : near(c.x + c.w, c.y + c.h) ? 'se'
        : x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h ? 'move' : null;
      if (handle) dragRef.current = { kind: 'crop', handle, start: [x, y], crop: c };
    } else if (mode === 'view' || mode === 'text') {
      const t = textAt(x, y);
      if (t) dragRef.current = { kind: 'text', id: t.id, offset: [x - t.x, y - t.y] };
    }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = toImage(e);
    if (d.kind === 'draw') {
      setEdit((ed) => {
        const strokes = [...ed.strokes];
        const last = strokes[strokes.length - 1];
        strokes[strokes.length - 1] = { ...last, points: [...last.points, [x, y]] };
        return { ...ed, strokes };
      });
    } else if (d.kind === 'text') {
      setEdit((ed) => ({ ...ed, texts: ed.texts.map((t) => (t.id === d.id ? { ...t, x: x - d.offset[0], y: y - d.offset[1] } : t)) }));
    } else if (d.kind === 'crop') {
      const W = img.naturalWidth; const H = img.naturalHeight;
      const { crop: c, handle, start } = d;
      const dx = x - start[0]; const dy = y - start[1];
      let { x: cx, y: cy, w, h } = c;
      if (handle === 'move') {
        cx = clamp(c.x + dx, 0, W - c.w);
        cy = clamp(c.y + dy, 0, H - c.h);
      } else {
        if (handle.includes('w')) { cx = clamp(c.x + dx, 0, c.x + c.w - MIN_CROP); w = c.x + c.w - cx; }
        if (handle.includes('e')) { w = clamp(c.w + dx, MIN_CROP, W - c.x); }
        if (handle.includes('n')) { cy = clamp(c.y + dy, 0, c.y + c.h - MIN_CROP); h = c.y + c.h - cy; }
        if (handle.includes('s')) { h = clamp(c.h + dy, MIN_CROP, H - c.y); }
      }
      setDraftCrop({ x: cx, y: cy, w, h });
    }
  };

  const onPointerUp = () => { dragRef.current = null; };

  const undo = () => setEdit((ed) => (mode === 'text'
    ? { ...ed, texts: ed.texts.slice(0, -1) }
    : { ...ed, strokes: ed.strokes.slice(0, -1) }));

  const addText = () => {
    const value = textDraft.trim();
    if (!value) return;
    setEdit((ed) => ({
      ...ed,
      texts: [...ed.texts, {
        id: `${ed.texts.length}-${value}`, text: value, color,
        x: ed.crop.x + ed.crop.w / 2, y: ed.crop.y + ed.crop.h / 2, size: Math.max(ed.crop.w / 11, 18),
      }],
    }));
    setTextDraft('');
  };

  const openTool = (next) => {
    setMenuOpen(false);
    if (next === 'crop') setDraftCrop(edit.crop);
    if (next === 'adjust') editBeforeAdjust.current = edit.adjust;
    setMode((m) => (m === next && (next === 'draw' || next === 'text') ? 'view' : next));
  };

  const exportResult = useCallback(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(edit.crop.w);
    canvas.height = Math.round(edit.crop.h);
    paint(canvas.getContext('2d'), img, edit, edit.crop, 1);
    const file = await canvasToJpeg(canvas, item.originalFile?.name || 'photo.jpg');
    return { edit, file, url: URL.createObjectURL(file) };
  }, [edit, img, item]);

  const save = async () => {
    setMenuOpen(false);
    const { file, url } = await exportResult();
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const finish = async (send) => {
    if (busy || !edit) return;
    setBusy(true);
    const result = await exportResult();
    setBusy(false);
    (send ? onSend : onDone)(result);
  };

  const toolBtn = (key, Icon, label) => (
    <button type="button" className={`cie-tool${mode === key ? ' active' : ''}`} onClick={() => openTool(key)} aria-label={label} title={label}>
      <Icon size={18} />
    </button>
  );

  return (
    <div className="cie" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div className="cie-top">
        <button type="button" className="cie-tool" onClick={onCancel} aria-label="Close editor"><X size={20} /></button>
        <div className="cie-tools">
          {(mode === 'draw' || mode === 'text') && (
            <button type="button" className="cie-tool" onClick={undo} aria-label="Undo" title="Undo"><Undo2 size={18} /></button>
          )}
          {toolBtn('draw', PenLine, 'Draw')}
          {toolBtn('text', Type, 'Add text')}
          <div className="cie-menu-wrap">
            <button type="button" className={`cie-tool${menuOpen ? ' active' : ''}`} onClick={() => setMenuOpen((v) => !v)} aria-label="More options" aria-expanded={menuOpen}>
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div className="cie-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => openTool('crop')}>Crop <Crop size={16} /></button>
                <button type="button" role="menuitem" onClick={() => openTool('adjust')}>Adjust <SlidersHorizontal size={16} /></button>
                <button type="button" role="menuitem" onClick={save}>Save <Download size={16} /></button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cie-stage" ref={stageRef} onClick={() => setMenuOpen(false)}>
        {!img && <span className="cie-loading">Loading…</span>}
        <canvas
          ref={canvasRef}
          className={`cie-canvas cie-canvas--${mode}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {(mode === 'draw' || mode === 'text') && (
        <div className="cie-colors" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={color === c} aria-label={c}
              className={`cie-color${color === c ? ' active' : ''}`} style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      )}

      {mode === 'text' && (
        <div className="cie-textbar">
          <input
            className="cie-text-input" placeholder="Type text, then Add" value={textDraft} maxLength={60} autoFocus
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addText(); }}
          />
          <button type="button" className="cie-pill" onClick={addText} disabled={!textDraft.trim()}>Add</button>
        </div>
      )}

      {mode === 'adjust' && edit && (
        <div className="cie-adjust">
          {[['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturate', 'Saturation']].map(([key, label]) => (
            <label key={key} className="cie-slider">
              <span>{label}</span>
              <input
                type="range" min={key === 'saturate' ? 0 : 50} max={key === 'saturate' ? 200 : 150}
                value={edit.adjust[key]}
                onChange={(e) => setEdit((ed) => ({ ...ed, adjust: { ...ed.adjust, [key]: Number(e.target.value) } }))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="cie-bottom">
        {mode === 'crop' ? (
          <>
            <button type="button" className="cie-pill cie-pill--ghost" onClick={() => setMode('view')}>Cancel</button>
            <button type="button" className="cie-pill" onClick={() => { setEdit((ed) => ({ ...ed, crop: draftCrop })); setMode('view'); }}>
              <Check size={16} /> Apply crop
            </button>
          </>
        ) : mode === 'adjust' ? (
          <>
            <button type="button" className="cie-pill cie-pill--ghost" onClick={() => { setEdit((ed) => ({ ...ed, adjust: editBeforeAdjust.current })); setMode('view'); }}>Cancel</button>
            <button type="button" className="cie-pill" onClick={() => setMode('view')}><Check size={16} /> Apply</button>
          </>
        ) : (
          <>
            <button type="button" className="cie-pill cie-pill--ghost" onClick={() => finish(false)} disabled={busy || !edit}>
              <Check size={16} /> Done
            </button>
            <button type="button" className="cie-pill cie-pill--send" onClick={() => finish(true)} disabled={busy || !edit}>
              Send <Send size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
