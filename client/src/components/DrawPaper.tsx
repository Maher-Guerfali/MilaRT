import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BaseItem, PaperData, PaperImageEl, Stroke, StrokeTool } from '../types';
import { api } from '../api';
import {
  PenIcon, EraserIcon, HandIcon, ImageIcon, UndoIcon, RedoIcon,
  PlusIcon, MinusIcon, TrashIcon, CloseIcon,
} from './icons';
import StrokeLayer from './StrokeLayer';
import { nanoid } from 'nanoid';

interface Props {
  item: BaseItem;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onClose: () => void;
}

type Tool = 'pen' | 'eraser' | 'move';
type SizeKey = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<SizeKey, number> = { sm: 3, md: 6, lg: 12 };
const MIN_SCALE = 0.15;
const MAX_SCALE = 8;
const PRESETS = ['#1a1510', '#D97435', '#E8B830', '#2a9d8f', '#3b82f6', '#e76f51', '#8b5cf6', '#ffffff'];

// The 5 underlying brush styles rendered by StrokeLayer, surfaced here as
// selectable "pens" à la Paper.
const PEN_TYPES: { tool: StrokeTool; label: string }[] = [
  { tool: 'pen', label: 'Pen' },
  { tool: 'fountain', label: 'Ink' },
  { tool: 'pencil', label: 'Pencil' },
  { tool: 'marker', label: 'Marker' },
  { tool: 'brush', label: 'Brush' },
];

interface Snap { strokes: Stroke[]; images: PaperImageEl[]; }

export default function DrawPaper({ item, onUpdate, onClose }: Props) {
  const data = item.data as Partial<PaperData>;
  const wrapRef = useRef<HTMLDivElement>(null);

  const [strokes, setStrokes] = useState<Stroke[]>(() => data.strokes ?? []);
  const [images, setImages] = useState<PaperImageEl[]>(() => data.images ?? []);
  const [history, setHistory] = useState<Snap[]>([]);
  const [redo, setRedo] = useState<Snap[]>([]);

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>('pen');
  const [penType, setPenType] = useState<StrokeTool>('pen');
  const [color, setColor] = useState('#1a1510');
  const [size, setSize] = useState<SizeKey>('md');
  const [trayOpen, setTrayOpen] = useState(true);

  // Mount / unmount transition flags.
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);

  // ── History helpers ────────────────────────────────────────────────
  function snapshot(): Snap { return { strokes, images }; }
  function commitStrokes(next: Stroke[]) {
    setHistory((h) => [...h, snapshot()]);
    setRedo([]);
    setStrokes(next);
  }
  function commitImages(next: PaperImageEl[]) {
    setHistory((h) => [...h, snapshot()]);
    setRedo([]);
    setImages(next);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setRedo((r) => [...r, snapshot()]);
      setStrokes(prev.strokes);
      setImages(prev.images);
      return h.slice(0, -1);
    });
  }
  function redoAction() {
    setRedo((r) => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setHistory((h) => [...h, snapshot()]);
      setStrokes(next.strokes);
      setImages(next.images);
      return r.slice(0, -1);
    });
  }

  // ── Coordinate helpers ─────────────────────────────────────────────
  function toWorld(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }
  function clampScale(s: number) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }
  function zoomAround(clientX: number, clientY: number, nextScale: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    setView((v) => {
      const ns = clampScale(nextScale);
      const wx = (cx - v.x) / v.scale;
      const wy = (cy - v.y) / v.scale;
      return { scale: ns, x: cx - wx * ns, y: cy - wy * ns };
    });
  }
  function bumpZoom(dir: 1 | -1) {
    const rect = wrapRef.current!.getBoundingClientRect();
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, view.scale * (dir > 0 ? 1.25 : 0.8));
  }
  function resetView() { setView({ x: 0, y: 0, scale: 1 }); }

  // Wheel zoom (works in every tool).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAround(e.clientX, e.clientY, view.scale * factor);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Two-finger pinch zoom — only in Move mode so it never fights the pen.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let active = false, startDist = 0, startScale = 1;
    function start(e: TouchEvent) {
      if (tool !== 'move' || e.touches.length !== 2) return;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      startScale = viewRef.current.scale;
      active = true; e.preventDefault();
    }
    function move(e: TouchEvent) {
      if (!active || e.touches.length !== 2 || startDist === 0) return;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const cx = (t1.clientX + t2.clientX) / 2, cy = (t1.clientY + t2.clientY) / 2;
      zoomAround(cx, cy, startScale * (dist / startDist));
      e.preventDefault();
    }
    function end(e: TouchEvent) { if (e.touches.length < 2) active = false; }
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [tool]);

  // ── Background pan (Move tool, empty space) ─────────────────────────
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  function onBgPointerDown(e: React.PointerEvent) {
    if (tool !== 'move') return;
    if ((e.target as HTMLElement).closest('[data-paper-img]')) return;
    panRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    const p = panRef.current;
    if (!p) return;
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.px), y: p.vy + (e.clientY - p.py) }));
  }
  function onBgPointerUp() { panRef.current = null; }

  // ── Image import + manipulation ─────────────────────────────────────
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { url } = await api.uploadImage(f);
      const rect = wrapRef.current!.getBoundingClientRect();
      const center = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const natural = await loadSize(url);
      const w = 260;
      const h = Math.round(w * (natural.h / natural.w)) || 200;
      const img: PaperImageEl = { id: nanoid(8), url, x: center.x - w / 2, y: center.y - h / 2, w, h };
      commitImages([...images, img]);
      setTool('move'); // so it can be repositioned right away
    } catch (err) {
      alert('Image upload failed: ' + (err as Error).message);
    }
  }

  const imgDragRef = useRef<{ id: string; mode: 'move' | 'resize'; px: number; py: number; ix: number; iy: number; iw: number; ih: number } | null>(null);
  function startImgDrag(e: React.PointerEvent, img: PaperImageEl, mode: 'move' | 'resize') {
    e.stopPropagation();
    setHistory((h) => [...h, snapshot()]);
    setRedo([]);
    imgDragRef.current = { id: img.id, mode, px: e.clientX, py: e.clientY, ix: img.x, iy: img.y, iw: img.w, ih: img.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onImgDrag(e: React.PointerEvent) {
    const d = imgDragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / view.scale;
    const dy = (e.clientY - d.py) / view.scale;
    setImages((arr) => arr.map((im) => {
      if (im.id !== d.id) return im;
      if (d.mode === 'move') return { ...im, x: d.ix + dx, y: d.iy + dy };
      return { ...im, w: Math.max(40, d.iw + dx), h: Math.max(30, d.ih + dy) };
    }));
  }
  function onImgUp() { imgDragRef.current = null; }
  function deleteImage(id: string) { commitImages(images.filter((im) => im.id !== id)); }

  // ── Close (save + split animation) ──────────────────────────────────
  function handleClose() {
    onUpdate({ data: { ...data, strokes, images } });
    setClosing(true);
    window.setTimeout(onClose, 480);
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); handleClose(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoAction(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, images, history, redo]);

  const drawMode = tool === 'pen' || tool === 'eraser';
  const tf = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 300000, background: 'transparent' }}>
      {/* ── Split sheets (the white paper that tears apart on close) ── */}
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        style={{
          background: '#FCFBF8',
          transform: closing ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 0.46s cubic-bezier(0.7,0,0.3,1)',
          boxShadow: closing ? '8px 0 24px rgba(0,0,0,0.18)' : 'none',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        style={{
          background: '#FCFBF8',
          transform: closing ? 'translateX(100%)' : 'translateX(0)',
          transition: 'transform 0.46s cubic-bezier(0.7,0,0.3,1)',
          boxShadow: closing ? '-8px 0 24px rgba(0,0,0,0.18)' : 'none',
        }}
      />

      {/* ── Drawing surface ── */}
      <div
        ref={wrapRef}
        className="absolute inset-0 overflow-hidden"
        style={{
          opacity: closing ? 0 : entered ? 1 : 0,
          transition: closing ? 'opacity 0.22s ease' : 'opacity 0.3s ease',
          cursor: tool === 'move' ? 'grab' : 'crosshair',
          touchAction: 'none',
        }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerCancel={onBgPointerUp}
      >
        {/* Imported images (below strokes so you can draw over them) */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: tf, pointerEvents: 'none' }}
        >
          {images.map((im) => (
            <div
              key={im.id}
              data-paper-img
              className="absolute group/pi"
              style={{
                left: im.x, top: im.y, width: im.w, height: im.h,
                pointerEvents: tool === 'move' ? 'auto' : 'none',
              }}
              onPointerDown={(e) => tool === 'move' && startImgDrag(e, im, 'move')}
              onPointerMove={onImgDrag}
              onPointerUp={onImgUp}
              onPointerCancel={onImgUp}
            >
              <img src={im.url} alt="" draggable={false}
                className="w-full h-full object-contain select-none pointer-events-none"
                style={{ outline: tool === 'move' ? '1px dashed rgba(217,116,53,0.5)' : 'none' }} />
              {tool === 'move' && (
                <>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); deleteImage(im.id); }}
                    className="absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-ink text-paper flex items-center justify-center shadow opacity-0 group-hover/pi:opacity-100"
                    style={{ transform: `scale(${1 / view.scale})`, transformOrigin: 'center' }}
                    title="Delete image"
                  ><TrashIcon size={12} /></button>
                  <div
                    onPointerDown={(e) => startImgDrag(e, im, 'resize')}
                    onPointerMove={onImgDrag}
                    onPointerUp={onImgUp}
                    onPointerCancel={onImgUp}
                    className="absolute -bottom-2 -right-2 w-5 h-5 rounded-full bg-amber ring-2 ring-white shadow cursor-nwse-resize opacity-0 group-hover/pi:opacity-100"
                    style={{ transform: `scale(${1 / view.scale})`, transformOrigin: 'center' }}
                    title="Resize"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Strokes */}
        <StrokeLayer
          view={view}
          strokes={strokes}
          drawMode={drawMode}
          color={color}
          width={SIZE_PX[size]}
          tool={penType}
          eraser={tool === 'eraser'}
          penOnly={false}
          onChange={commitStrokes}
          onAddStroke={(s) => commitStrokes([...strokes, s])}
          toWorld={toWorld}
        />
      </div>

      {/* ── Top-right controls: zoom + close ── */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2"
        style={{ zIndex: 320000, opacity: closing ? 0 : 1, transition: 'opacity 0.2s ease' }}
      >
        <div className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-paper/95 shadow ring-1 ring-ink/10 backdrop-blur">
          <button onClick={() => bumpZoom(-1)} className="w-7 h-7 rounded-full hover:bg-ink/10 flex items-center justify-center text-ink/70" title="Zoom out"><MinusIcon size={15} /></button>
          <button onClick={resetView} className="px-1.5 text-[11px] font-bold text-ink/60 tabular-nums" title="Reset to 100%">{Math.round(view.scale * 100)}%</button>
          <button onClick={() => bumpZoom(1)} className="w-7 h-7 rounded-full hover:bg-ink/10 flex items-center justify-center text-ink/70" title="Zoom in"><PlusIcon size={15} /></button>
        </div>
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-ink text-paper shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          title="Save & close"
        ><CloseIcon size={18} /></button>
      </div>

      {/* ── Bottom slideable toolbar ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex justify-center"
        style={{ zIndex: 320000, pointerEvents: 'none' }}
      >
        <div
          className="pointer-events-auto mb-0"
          style={{
            transform: closing ? 'translateY(140%)' : trayOpen ? 'translateY(0)' : 'translateY(calc(100% - 26px))',
            transition: 'transform 0.32s cubic-bezier(0.4,0,0.2,1)',
            background: 'rgba(253,250,245,0.97)',
            backdropFilter: 'blur(18px)',
            borderRadius: '18px 18px 0 0',
            border: '1px solid rgba(26,21,16,0.10)',
            borderBottom: 'none',
            boxShadow: '0 -6px 32px rgba(26,21,16,0.14)',
            padding: '6px 18px 14px',
            maxWidth: '94vw',
          }}
        >
          {/* Drag handle to slide the tray up/down */}
          <button onClick={() => setTrayOpen((o) => !o)} className="w-full flex justify-center mb-2 cursor-pointer" title={trayOpen ? 'Hide tools' : 'Show tools'}>
            <div className="w-10 h-1.5 rounded-full bg-ink/15" />
          </button>

          <div className="flex items-end gap-1 flex-wrap justify-center">
            {/* Tools */}
            <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen"><PenIcon size={18} /></ToolBtn>
            <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser"><EraserIcon size={18} /></ToolBtn>
            <ToolBtn active={tool === 'move'} onClick={() => setTool('move')} title="Move / zoom (pan, pinch, drag images)"><HandIcon size={18} /></ToolBtn>
            <ToolBtn active={false} onClick={() => fileRef.current?.click()} title="Import image"><ImageIcon size={18} /></ToolBtn>

            <Divider />

            {/* Pen types */}
            <div className="flex items-end gap-0.5" style={{ opacity: tool === 'eraser' ? 0.35 : 1, pointerEvents: tool === 'eraser' ? 'none' : 'auto' }}>
              {PEN_TYPES.map((p) => (
                <button
                  key={p.tool}
                  onClick={() => { setPenType(p.tool); if (tool !== 'pen') setTool('pen'); }}
                  title={p.label}
                  className="flex flex-col items-center gap-1 px-1.5 pt-1 pb-1 rounded-lg transition-colors"
                  style={{ background: penType === p.tool && tool !== 'eraser' ? 'rgba(217,116,53,0.10)' : 'transparent' }}
                >
                  <PenStroke tool={p.tool} color={penType === p.tool ? color : '#9a948c'} />
                  <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: penType === p.tool ? '#D97435' : 'rgba(26,21,16,0.4)' }}>{p.label}</span>
                </button>
              ))}
            </div>

            <Divider />

            {/* Colors */}
            <div className="flex flex-col gap-1" style={{ opacity: tool === 'eraser' ? 0.35 : 1, pointerEvents: tool === 'eraser' ? 'none' : 'auto' }}>
              <div className="flex gap-1">
                {PRESETS.slice(0, 4).map((c) => <ColorDot key={c} color={c} active={color === c} onClick={() => setColor(c)} />)}
              </div>
              <div className="flex gap-1">
                {PRESETS.slice(4).map((c) => <ColorDot key={c} color={c} active={color === c} onClick={() => setColor(c)} />)}
                <button
                  onClick={() => colorRef.current?.click()}
                  className="relative w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ border: '2px dashed rgba(26,21,16,0.18)', background: !PRESETS.includes(color) ? color : '#FDFAF5' }}
                  title="Custom colour"
                >
                  {PRESETS.includes(color) && <span className="text-[11px] text-ink/45 leading-none">+</span>}
                  <input ref={colorRef} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute opacity-0 w-0 h-0 pointer-events-none" />
                </button>
              </div>
            </div>

            <Divider />

            {/* Size */}
            <div className="flex flex-col items-center gap-1" style={{ opacity: tool === 'move' ? 0.35 : 1 }}>
              <span className="text-[8px] font-bold text-ink/45 uppercase tracking-wide leading-none">Size</span>
              {(['sm', 'md', 'lg'] as SizeKey[]).map((k) => (
                <button key={k} onClick={() => setSize(k)} className="rounded-full transition-all"
                  style={{
                    width: k === 'sm' ? 6 : k === 'md' ? 10 : 15,
                    height: k === 'sm' ? 6 : k === 'md' ? 10 : 15,
                    background: size === k ? '#D97435' : 'rgba(26,21,16,0.18)',
                    boxShadow: size === k ? '0 0 0 3px rgba(217,116,53,0.22)' : 'none',
                  }} />
              ))}
            </div>

            <Divider />

            {/* Undo / redo */}
            <div className="flex gap-0.5">
              <button onClick={undo} disabled={!history.length} className="w-9 h-9 rounded-lg flex items-center justify-center text-ink/70 hover:bg-ink/10 disabled:opacity-30" title="Undo"><UndoIcon size={17} /></button>
              <button onClick={redoAction} disabled={!redo.length} className="w-9 h-9 rounded-lg flex items-center justify-center text-ink/70 hover:bg-ink/10 disabled:opacity-30" title="Redo"><RedoIcon size={17} /></button>
            </div>
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImportFile} />
    </div>,
    document.body
  );
}

// ── Small UI helpers ──────────────────────────────────────────────────
function ToolBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex flex-col items-center gap-1 px-2.5 pt-1.5 pb-1 rounded-xl transition-colors"
      style={{ background: active ? 'rgba(217,116,53,0.12)' : 'transparent', color: active ? '#D97435' : 'rgba(26,21,16,0.55)' }}
    >
      {children}
      <div className="rounded-full transition-all" style={{ width: active ? 16 : 5, height: 3, background: active ? '#D97435' : 'rgba(26,21,16,0.12)' }} />
    </button>
  );
}

function Divider() { return <div className="w-px h-11 bg-ink/10 mx-2 self-center" />; }

function ColorDot({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full transition-all flex-shrink-0"
      style={{
        width: 20, height: 20, background: color,
        boxShadow: active ? `0 0 0 2px white, 0 0 0 4px ${color === '#ffffff' ? '#D97435' : color}` : '0 1px 3px rgba(0,0,0,0.18)',
        border: color === '#ffffff' ? '1px solid rgba(26,21,16,0.15)' : 'none',
        transform: active ? 'scale(1.15)' : 'scale(1)',
      }} />
  );
}

function PenStroke({ tool, color }: { tool: StrokeTool; color: string }) {
  // A tiny swatch hinting at each brush's character.
  const common = { stroke: color, fill: 'none', strokeLinecap: 'round' as const };
  return (
    <svg width="30" height="16" viewBox="0 0 30 16">
      {tool === 'pen' && <path d="M2 8 Q15 8 28 8" {...common} strokeWidth={2.5} />}
      {tool === 'fountain' && <path d="M2 11 Q15 2 28 9" {...common} strokeWidth={3.2} />}
      {tool === 'pencil' && <path d="M2 9 Q15 6 28 8" {...common} strokeWidth={2} opacity={0.6} />}
      {tool === 'marker' && <path d="M2 8 H28" {...common} strokeWidth={5} opacity={0.55} strokeLinecap="butt" />}
      {tool === 'brush' && <path d="M2 10 Q10 3 16 9 T28 7" {...common} strokeWidth={3.6} opacity={0.85} />}
    </svg>
  );
}

// Load an image just to read its natural aspect ratio.
function loadSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = url;
  });
}
