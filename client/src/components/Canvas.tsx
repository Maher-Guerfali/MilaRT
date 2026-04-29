import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem, Stroke } from '../types';
import { api } from '../api';
import ItemView from './ItemView';
import StrokeLayer from './StrokeLayer';
import type { Mode } from './DrawToolbar';
import { PlusIcon, MinusIcon, FitIcon } from './icons';

interface Props {
  items: BaseItem[];
  strokes: Stroke[];
  mode: Mode;
  drawColor: string;
  drawWidth: number;
  drawTool: string;
  penOnly: boolean;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  onUpdateMany: (ids: string[], delta: { dx: number; dy: number }) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onAdd: (item: BaseItem) => void;
  onSetStrokes: (next: Stroke[]) => void;
  onEnterBoard: (itemId: string) => void;
}

export interface CanvasHandle {
  getCenter: () => { x: number; y: number };
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({
  items, strokes, mode, drawColor, drawWidth, drawTool, penOnly,
  onUpdate, onUpdateMany, onDelete, onDeleteMany, onAdd, onSetStrokes, onEnterBoard,
}, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const marqueeStart = useRef<{ wx: number; wy: number } | null>(null);

  const drawMode = mode !== 'drag';
  const eraser = mode === 'erase';
  const interactive = mode === 'drag';

  function toWorld(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }
  function centerOfView() {
    const rect = wrapRef.current!.getBoundingClientRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  useImperativeHandle(ref, () => ({ getCenter: centerOfView }));

  function zoomAround(clientX: number, clientY: number, nextScale: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const worldX = (cx - view.x) / view.scale;
    const worldY = (cy - view.y) / view.scale;
    setView({ scale: nextScale, x: cx - worldX * nextScale, y: cy - worldY * nextScale });
  }
  function bumpZoom(delta: number) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * (1 + delta)));
    const rect = wrapRef.current!.getBoundingClientRect();
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, next);
  }
  function resetView() { setView({ x: 0, y: 0, scale: 1 }); }

  // Background pointerdown:
  //   - in draw mode: ignored (StrokeLayer handles)
  //   - shift held: start a marquee for multi-select
  //   - otherwise: start a pan
  function onBgPointerDown(e: React.PointerEvent) {
    if (drawMode) return;
    if ((e.target as HTMLElement).closest('[data-item]')) return;
    if (!e.shiftKey) setSelection(new Set());

    if (e.shiftKey || e.button === 2) {
      // Marquee
      const w = toWorld(e.clientX, e.clientY);
      marqueeStart.current = { wx: w.x, wy: w.y };
      setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    if (marqueeStart.current) {
      const w = toWorld(e.clientX, e.clientY);
      setMarquee({
        x0: marqueeStart.current.wx,
        y0: marqueeStart.current.wy,
        x1: w.x, y1: w.y,
      });
      return;
    }
    const ps = panStart.current;
    if (!panning || !ps) return;
    setView((v) => ({ ...v, x: ps.vx + (e.clientX - ps.px), y: ps.vy + (e.clientY - ps.py) }));
  }
  function onBgPointerUp(e: React.PointerEvent) {
    if (marqueeStart.current && marquee) {
      const x0 = Math.min(marquee.x0, marquee.x1);
      const x1 = Math.max(marquee.x0, marquee.x1);
      const y0 = Math.min(marquee.y0, marquee.y1);
      const y1 = Math.max(marquee.y0, marquee.y1);
      const hits = items
        .filter((it) => it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0)
        .map((it) => it.id);
      setSelection((prev) => {
        const next = new Set(prev);
        for (const id of hits) next.add(id);
        return next;
      });
    }
    marqueeStart.current = null;
    setMarquee(null);
    setPanning(false);
    panStart.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * (1 + delta)));
      zoomAround(e.clientX, e.clientY, next);
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  function placeImageNow(url: string, cx: number, cy: number, defaultW = 280, defaultH = 200) {
    onAdd({
      id: nanoid(10),
      type: 'image',
      x: cx - defaultW / 2,
      y: cy - defaultH / 2,
      w: defaultW,
      h: defaultH,
      z: 0,
      data: { url },
    });
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const start = toWorld(e.clientX, e.clientY);
    let off = 0;
    for (const file of files) {
      try {
        const { url } = await api.uploadImage(file);
        placeImageNow(url, start.x + off, start.y + off);
        off += 30;
      } catch (err) {
        alert('Image upload failed: ' + (err as Error).message);
      }
    }
  }

  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const imgItem = Array.from(cd.items).find((it) => it.type.startsWith('image/'));
      if (imgItem) {
        e.preventDefault();
        const file = imgItem.getAsFile();
        if (!file) return;
        try {
          const { url } = await api.uploadImage(file);
          const pos = centerOfView();
          placeImageNow(url, pos.x, pos.y);
        } catch (err) {
          alert('Image upload failed: ' + (err as Error).message);
        }
        return;
      }
      const text = cd.getData('text/plain');
      if (text) {
        e.preventDefault();
        const pos = centerOfView();
        const isUrl = /^https?:\/\//i.test(text.trim());
        onAdd({
          id: nanoid(10),
          type: isUrl ? 'link' : 'sticky',
          x: pos.x - 110, y: pos.y - 60,
          w: isUrl ? 260 : 220,
          h: isUrl ? 60 : 160,
          z: 0,
          data: isUrl ? { url: text.trim(), title: text.trim() } : { text, color: '#fff7ae' },
        });
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Delete deletes the whole selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
        e.preventDefault();
        onDeleteMany(Array.from(selection));
        setSelection(new Set());
      } else if (e.key === 'Escape') {
        setSelection(new Set());
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, onDeleteMany]);

  function selectItem(id: string, additive: boolean) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (additive) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        if (next.size === 1 && next.has(id)) return next;
        return new Set([id]);
      }
      return next;
    });
  }

  // Group move: when a selected item is dragged, all selected items move
  // by the same delta. Implemented via the onUpdateMany callback.
  function moveGroup(ids: string[], dx: number, dy: number) {
    onUpdateMany(ids, { dx, dy });
  }

  const cursor =
    mode === 'pen' ? 'crosshair' :
    mode === 'erase' ? 'cell' :
    panning ? 'grabbing' : 'grab';

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 board-bg no-select ${dragOver ? 'ring-4 ring-inset ring-blue-400/50' : ''}`}
      style={{ cursor }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onPointerCancel={onBgPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div
        className="absolute origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {items.map((it) => (
          <ItemView
            key={it.id}
            item={it}
            selected={selection.has(it.id)}
            selectionIds={Array.from(selection)}
            scale={view.scale}
            interactive={interactive}
            onSelect={(additive) => selectItem(it.id, additive)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onMoveGroup={moveGroup}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
          />
        ))}

        {/* Marquee rectangle (shift-drag on background). */}
        {marquee && (
          <div
            className="absolute pointer-events-none border border-blue-500/70 bg-blue-500/10"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
      </div>

      <StrokeLayer
        view={view}
        strokes={strokes}
        drawMode={drawMode}
        color={drawColor}
        width={drawWidth}
        tool={drawTool}
        eraser={eraser}
        penOnly={penOnly}
        onChange={onSetStrokes}
        toWorld={toWorld}
      />

      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/95 backdrop-blur rounded-lg shadow border border-black/10 p-1 text-xs">
        <button onClick={() => bumpZoom(-0.15)} className="w-7 h-7 rounded-md hover:bg-ink/5 flex items-center justify-center" title="Zoom out"><MinusIcon size={14} /></button>
        <button onClick={resetView} className="px-2 h-7 rounded-md hover:bg-ink/5 flex items-center gap-1 tabular-nums" title="Reset view (100%)">
          <FitIcon size={12} />
          <span>{Math.round(view.scale * 100)}%</span>
        </button>
        <button onClick={() => bumpZoom(0.15)} className="w-7 h-7 rounded-md hover:bg-ink/5 flex items-center justify-center" title="Zoom in"><PlusIcon size={14} /></button>
      </div>

      {selection.size > 1 && (
        <div className="absolute bottom-3 left-3 bg-ink text-paper rounded-lg shadow px-3 py-1 text-xs">
          {selection.size} selected — drag any to move all, Delete to remove, Esc to clear
        </div>
      )}
    </div>
  );
});

export default Canvas;
