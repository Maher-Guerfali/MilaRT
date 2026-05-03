import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem, Stroke } from '../types';
import { api } from '../api';
import ItemView from './ItemView';
import StrokeLayer from './StrokeLayer';
import MiniMap from './MiniMap';
import type { DrawTool, SizeKey } from './DrawTray';
import { PlusIcon, MinusIcon, FitIcon } from './icons';

interface Props {
  items: BaseItem[];
  strokes: Stroke[];
  isMove: boolean;
  drawOpen: boolean;
  drawTool: DrawTool;
  drawColor: string;
  penSize: SizeKey;
  eraserSize: SizeKey;
  penOnly: boolean;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  onUpdateMany: (ids: string[], delta: { dx: number; dy: number }) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onAdd: (item: BaseItem) => void;
  onSetStrokes: (next: Stroke[]) => void;
  onAddStroke: (s: Stroke) => void;
  onMoveLayer: (id: string, dir: 'forward' | 'backward') => void;
  onEnterBoard: (itemId: string) => void;
  onSendToStorage?: (id: string) => void;
  onRestoreFromStorageAt?: (id: string, x: number, y: number) => void;
}

export interface CanvasHandle {
  getCenter: () => { x: number; y: number };
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const SIZE_TO_PX: Record<SizeKey, number> = { sm: 2, md: 4, lg: 8 };

function ptInPoly(px: number, py: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  const {
    items, strokes, isMove, drawOpen, drawTool, drawColor, penSize, eraserSize, penOnly,
    onUpdate, onUpdateMany, onDelete, onDeleteMany, onAdd, onSetStrokes, onAddStroke, onMoveLayer, onEnterBoard,
    onSendToStorage, onRestoreFromStorageAt,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lassoPath, setLassoPath] = useState<[number, number][]>([]);
  const [lassoActive, setLassoActive] = useState(false);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  // Pinch-to-zoom: track the two active pointer positions.
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null);

  const inDrawMode  = drawOpen && drawTool === 'pencil';
  const inEraseMode = drawOpen && drawTool === 'eraser';
  const inSelectMode = drawOpen && drawTool === 'select';
  const interactive = isMove && !drawOpen;

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

  // Track wrap size so the mini-map can draw the viewport rect accurately.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

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

  function onBgPointerDown(e: React.PointerEvent) {
    // Track all touch/pointer contacts for pinch detection.
    pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (drawOpen && drawTool !== 'select') return;
    if ((e.target as HTMLElement).closest('[data-item]')) return;

    // Two-finger pinch detected — stop panning, start pinch.
    if (pinchRef.current.size === 2) {
      setPanning(false);
      panStart.current = null;
      const pts = Array.from(pinchRef.current.values());
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartRef.current = { dist, scale: view.scale, cx, cy };
      return;
    }

    if (inSelectMode) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toWorld(e.clientX, e.clientY);
      setLassoPath([[p.x, p.y]]);
      setLassoActive(true);
      setSelection(new Set());
      return;
    }

    if (!interactive) return;
    if (!e.shiftKey) setSelection(new Set());
    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgPointerMove(e: React.PointerEvent) {
    // Update tracked position.
    if (pinchRef.current.has(e.pointerId)) {
      pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Active pinch — two fingers.
    if (pinchRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pinchRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const { dist: startDist, scale: startScale, cx, cy } = pinchStartRef.current;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * (dist / startDist)));
      zoomAround(cx, cy, nextScale);
      return;
    }

    if (lassoActive) {
      const p = toWorld(e.clientX, e.clientY);
      setLassoPath((prev) => [...prev, [p.x, p.y]]);
      return;
    }
    const ps = panStart.current;
    if (!panning || !ps) return;
    setView((v) => ({ ...v, x: ps.vx + (e.clientX - ps.px), y: ps.vy + (e.clientY - ps.py) }));
  }

  function onBgPointerUp(e: React.PointerEvent) {
    pinchRef.current.delete(e.pointerId);
    if (pinchRef.current.size < 2) pinchStartRef.current = null;

    if (lassoActive) {
      setLassoActive(false);
      const poly = lassoPath;
      if (poly.length >= 3) {
        const hits = new Set<string>();
        items.forEach((it) => {
          const cx = it.x + it.w / 2;
          const cy = it.y + it.h / 2;
          if (ptInPoly(cx, cy, poly)) hits.add(it.id);
        });
        setSelection(hits);
      }
      setTimeout(() => setLassoPath([]), 600);
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
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

  function placeImageNow(url: string, cx: number, cy: number, defaultW = 218, defaultH = 148) {
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

    // Storage → canvas: restore an item dragged out of the Storage drawer.
    // We can't see stored items in `items` here (parent filters them out), so
    // pass the cursor world coords and let the parent centre using the item's
    // own w/h.
    const restoreId = e.dataTransfer.getData('application/milart-storage-restore');
    if (restoreId && onRestoreFromStorageAt) {
      const pos = toWorld(e.clientX, e.clientY);
      onRestoreFromStorageAt(restoreId, pos.x, pos.y);
      return;
    }

    // Sidebar item drag-to-place
    const itemJson = e.dataTransfer.getData('application/milart-item');
    if (itemJson) {
      try {
        const template = JSON.parse(itemJson) as Omit<BaseItem, 'x' | 'y'>;
        const pos = toWorld(e.clientX, e.clientY);
        onAdd({
          ...template,
          x: pos.x - template.w / 2,
          y: pos.y - template.h / 2,
          z: 0,
        } as BaseItem);
      } catch { /* ignore bad data */ }
      return;
    }

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
        const trimmed = text.trim();
        const isUrl = /^https?:\/\//i.test(trimmed);
        const isYouTube = isUrl && /(?:youtube\.com|youtu\.be)/i.test(trimmed);
        onAdd({
          id: nanoid(10),
          type: isUrl ? 'link' : 'sticky',
          x: pos.x - 99, y: pos.y - 33,
          w: isYouTube ? 320 : isUrl ? 218 : 198,
          h: isYouTube ? 200 : isUrl ? 44 : 164,
          z: 0,
          data: isUrl ? { url: trimmed, title: trimmed } : { text, color: '#FFF3C4' },
        });
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

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
        return new Set([id]);
      }
      return next;
    });
  }

  function moveGroup(ids: string[], dx: number, dy: number) {
    onUpdateMany(ids, { dx, dy });
  }

  const cursor =
    inSelectMode  ? 'crosshair' :
    inEraseMode   ? 'cell' :
    inDrawMode    ? 'crosshair' :
    panning       ? 'grabbing' : 'grab';

  const lassoPoints = lassoPath
    .map(([x, y]) => `${x * view.scale + view.x},${y * view.scale + view.y}`)
    .join(' ');

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 board-bg no-select ${dragOver ? 'ring-4 ring-inset ring-amber/50' : ''}`}
      style={{ cursor, top: 46, touchAction: 'none' }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onPointerCancel={onBgPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
      onDragLeave={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
    >
      <div
        className={`absolute origin-top-left ${selection.size ? 'z-20' : ''}`}
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
            strokes={strokes}
            view={view}
            onSelect={(additive) => selectItem(it.id, additive)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onMoveGroup={moveGroup}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
            onMoveLayer={onMoveLayer}
            onSendToStorage={onSendToStorage}
          />
        ))}
      </div>

      <StrokeLayer
        view={view}
        strokes={strokes}
        drawMode={inDrawMode || inEraseMode}
        color={drawColor}
        width={inEraseMode ? SIZE_TO_PX[eraserSize] : SIZE_TO_PX[penSize]}
        tool="pen"
        eraser={inEraseMode}
        penOnly={penOnly}
        onChange={onSetStrokes}
        onAddStroke={onAddStroke}
        toWorld={toWorld}
      />

      {lassoPath.length > 1 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-30">
          <polygon
            points={lassoPoints}
            fill="rgba(217,116,53,0.08)"
            stroke="#D97435"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            className="animate-marchAnt"
          />
        </svg>
      )}

      {/* Mini-map sits above the zoom dock in the bottom-right. */}
      <MiniMap
        items={items}
        view={view}
        canvasSize={size}
        onNavigate={(wx, wy) => {
          // Centre the canvas view on the clicked world position.
          setView((v) => ({
            ...v,
            x: size.w / 2 - wx * v.scale,
            y: size.h / 2 - wy * v.scale,
          }));
        }}
      />

      <div
        className="absolute bottom-[22px] right-4 z-20 rounded-[13px] border border-ink/10 flex items-center p-1 gap-px"
        style={{
          background: 'rgba(253,250,245,0.96)',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 4px 18px rgba(26,21,16,0.09)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => bumpZoom(-0.15)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/50 hover:bg-ink/10 transition-colors"
          title="Zoom out"
        ><MinusIcon size={14} /></button>
        <button
          onClick={resetView}
          className="px-2.5 h-7 rounded-lg flex items-center gap-1 text-ink/50 hover:bg-ink/10 transition-colors text-[12px] font-bold tabular-nums"
          title="Reset (100%)"
        >
          <FitIcon size={12} />
          {Math.round(view.scale * 100)}%
        </button>
        <button
          onClick={() => bumpZoom(0.15)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/50 hover:bg-ink/10 transition-colors"
          title="Zoom in"
        ><PlusIcon size={14} /></button>
      </div>
    </div>
  );
});

export default Canvas;
