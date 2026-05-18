import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem, Stroke } from '../types';
import { api } from '../api';
import ItemView from './ItemView';
import StrokeLayer from './StrokeLayer';
import MiniMap from './MiniMap';
import PresenceLayer from './PresenceLayer';
import type { DrawTool, SizeKey } from './DrawTray';
import type { Peer } from '../hooks/usePresence';
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
  onMerge?: (srcId: string, targetId: string) => void;
  onOpenDocument?: (id: string) => void;
  /** Remote peers' cursors (rendered as an overlay). */
  peers?: Peer[];
  /** Called with the local cursor's world coords. Internally throttled. */
  onLocalCursorMove?: (x: number, y: number) => void;
}

export interface CanvasHandle {
  getCenter: () => { x: number; y: number };
  /** World-space size of the visible viewport — used to size pasted/scanned
   *  content to roughly fit on screen instead of a fixed world-px constant. */
  getViewportWorld: () => { centerX: number; centerY: number; worldW: number; worldH: number };
  /** Smoothly animate the camera so the given items fit (~70% default) the
   *  viewport. Used by the F shortcut and the per-item focus button. */
  focusOnIds: (ids: string[], opts?: { fit?: number; duration?: number }) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const SIZE_TO_PX: Record<SizeKey, number> = { sm: 2, md: 4, lg: 8 };

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

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
    onSendToStorage, onRestoreFromStorageAt, onMerge, onOpenDocument,
    peers, onLocalCursorMove,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lassoPath, setLassoPath] = useState<[number, number][]>([]);
  const [lassoActive, setLassoActive] = useState(false);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  // Cancels any focus animation in flight so a new F-press doesn't fight a
  // previous one mid-flight.
  const focusAnimRef = useRef<number | null>(null);
  // Remembers the pre-focus view so a second click on the same item's focus
  // button restores it. Cleared on any user-initiated pan/zoom so the
  // baseline never goes stale.
  const focusReturnRef = useRef<{ id: string; cx: number; cy: number; scale: number } | null>(null);

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
  function viewportWorld() {
    const rect = wrapRef.current!.getBoundingClientRect();
    const c = centerOfView();
    return {
      centerX: c.x,
      centerY: c.y,
      worldW: rect.width / view.scale,
      worldH: rect.height / view.scale,
    };
  }
  // Smoothly animate view (x, y, scale) so the union bbox of the given item
  // ids occupies ~70% of the visible viewport, centred. Used by the F-key
  // shortcut and the per-item focus button. Cancels any animation already
  // running so back-to-back presses don't fight each other.
  function animateView(toX: number, toY: number, toScale: number, duration: number) {
    if (focusAnimRef.current !== null) {
      cancelAnimationFrame(focusAnimRef.current);
      focusAnimRef.current = null;
    }
    // Use the React state at call time; mid-animation re-renders keep
    // refreshing the closure, but each invocation snapshots its own `from`.
    const from = { ...view };
    const t0 = performance.now();
    function step(now: number) {
      const k = Math.min(1, (now - t0) / duration);
      // easeOutCubic — quick deceleration feels responsive without overshoot.
      const e = 1 - Math.pow(1 - k, 3);
      setView({
        x: from.x + (toX - from.x) * e,
        y: from.y + (toY - from.y) * e,
        scale: from.scale + (toScale - from.scale) * e,
      });
      if (k < 1) {
        focusAnimRef.current = requestAnimationFrame(step);
      } else {
        focusAnimRef.current = null;
      }
    }
    focusAnimRef.current = requestAnimationFrame(step);
  }
  function focusOnIds(ids: string[], opts?: { fit?: number; duration?: number }) {
    const fit = opts?.fit ?? 0.7;
    const duration = opts?.duration ?? 360;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const targets = items.filter((it) => ids.includes(it.id));
    if (targets.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of targets) {
      if (it.x < minX) minX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.x + it.w > maxX) maxX = it.x + it.w;
      if (it.y + it.h > maxY) maxY = it.y + it.h;
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const cx = minX + bboxW / 2;
    const cy = minY + bboxH / 2;
    const rawScale = Math.min((rect.width * fit) / bboxW, (rect.height * fit) / bboxH);
    const inScale = clampScale(rawScale);

    // Toggle behaviour: a second focus on the same target zooms BACK OUT
    // around the same focus point (not to the previous arbitrary view).
    const key = ids.length === 1 ? ids[0] : ids.slice().sort().join(',');
    const saved = focusReturnRef.current;
    const isSecondPress = saved && saved.id === key && Math.abs(saved.scale - view.scale) < 0.01;
    const toScale = isSecondPress ? clampScale(inScale / 3) : inScale;
    const toX = rect.width / 2 - cx * toScale;
    const toY = rect.height / 2 - cy * toScale;

    focusReturnRef.current = isSecondPress
      ? null
      : { id: key, cx, cy, scale: inScale };
    animateView(toX, toY, toScale, duration);
  }

  useImperativeHandle(ref, () => ({
    getCenter: centerOfView,
    getViewportWorld: viewportWorld,
    focusOnIds,
  }));

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

  // Two-finger pinch zoom via native TouchEvents. Pointer events get
  // .stopPropagation()'d by items, so a pinch starting on a sticky/image
  // never reached the bg pinch logic. Touch events propagate
  // independently, and we attach as non-passive so we can preventDefault
  // the page-zoom behaviour Mobile Safari applies otherwise.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let active = false;
    let startDist = 0;
    let startScale = 1;
    let cx = 0;
    let cy = 0;
    function start(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      const t1 = e.touches[0], t2 = e.touches[1];
      startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      cx = (t1.clientX + t2.clientX) / 2;
      cy = (t1.clientY + t2.clientY) / 2;
      startScale = viewRef.current.scale;
      active = true;
      e.preventDefault();
    }
    function move(e: TouchEvent) {
      if (!active || e.touches.length !== 2 || startDist === 0) return;
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      // Recentre on the midpoint each frame so the canvas anchors to
      // the gesture rather than to its first sample, matching Milanote.
      cx = (t1.clientX + t2.clientX) / 2;
      cy = (t1.clientY + t2.clientY) / 2;
      zoomAround(cx, cy, startScale * (dist / startDist));
      e.preventDefault();
    }
    function end(e: TouchEvent) {
      if (e.touches.length < 2) active = false;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function zoomAround(clientX: number, clientY: number, nextScale: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    // Any manual zoom invalidates the focus-toggle baseline.
    focusReturnRef.current = null;
    // Re-read view inside the setter so concurrent updates (wheel + buttons)
    // don't fight each other.
    setView((v) => {
      const ns = clampScale(nextScale);
      const worldX = (cx - v.x) / v.scale;
      const worldY = (cy - v.y) / v.scale;
      return { scale: ns, x: cx - worldX * ns, y: cy - worldY * ns };
    });
  }
  function bumpZoom(direction: 1 | -1) {
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const rect = wrapRef.current!.getBoundingClientRect();
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, view.scale * factor);
  }
  function resetView() { focusReturnRef.current = null; setView({ x: 0, y: 0, scale: 1 }); }

  function onBgPointerDown(e: React.PointerEvent) {
    if (drawOpen && drawTool !== 'select') return;
    if ((e.target as HTMLElement).closest('[data-item]')) return;

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
    // Manual pan invalidates the focus-toggle baseline.
    focusReturnRef.current = null;
    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onBgPointerMove(e: React.PointerEvent) {
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

  // Broadcast our cursor at ~30Hz to any presence channel the parent wires
  // up. Native pointermove on the wrap fires regardless of children calling
  // stopPropagation, so cursors track correctly while hovering items too.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !onLocalCursorMove) return;
    let last = 0;
    function onMove(e: PointerEvent) {
      const now = performance.now();
      if (now - last < 33) return;
      last = now;
      const v = viewRef.current;
      const rect = el!.getBoundingClientRect();
      const wx = (e.clientX - rect.left - v.x) / v.scale;
      const wy = (e.clientY - rect.top - v.y) / v.scale;
      onLocalCursorMove!(wx, wy);
    }
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [onLocalCursorMove]);

  // Native wheel listener so we can preventDefault() — the browser would
  // otherwise zoom the page itself on Ctrl+wheel / trackpad-pinch.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Multiplicative zoom — exp keeps zoom in/out symmetric and
        // safe for large trackpad deltas (the old (1 + delta) form
        // could go negative and flip the canvas).
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAround(e.clientX, e.clientY, viewRef.current.scale * factor);
      } else {
        focusReturnRef.current = null;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      } else if ((e.key === 'f' || e.key === 'F') && selection.size && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // F = focus camera on the current selection. Skipped when modifier
        // keys are down so Ctrl-F / Cmd-F (browser find) still work normally.
        e.preventDefault();
        focusOnIds(Array.from(selection));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // focusOnIds closes over `items` and `view`; including them keeps the
  // handler in sync but doesn't matter much since we read fresh values inside.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, onDeleteMany, items]);

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
            isMergeTarget={mergeTargetId === it.id}
            onSelect={(additive) => selectItem(it.id, additive)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onMoveGroup={moveGroup}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
            onMoveLayer={onMoveLayer}
            onSendToStorage={onSendToStorage}
            onSetMergeTarget={setMergeTargetId}
            onMerge={onMerge}
            onOpenDocument={onOpenDocument}
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

      {peers && peers.length > 0 && (
        <PresenceLayer peers={peers} view={view} />
      )}

      {/* Mini-map sits above the zoom dock in the bottom-right. */}
      <MiniMap
        items={items}
        view={view}
        canvasSize={size}
        onNavigate={(wx, wy) => {
          focusReturnRef.current = null;
          // Centre the canvas view on the clicked world position.
          setView((v) => ({
            ...v,
            x: size.w / 2 - wx * v.scale,
            y: size.h / 2 - wy * v.scale,
          }));
        }}
        canFocus={selection.size > 0 || items.length > 0}
        onFocus={() => {
          const ids = selection.size > 0 ? Array.from(selection) : items.map((it) => it.id);
          if (ids.length === 0) return;
          focusOnIds(ids);
        }}
      />

      <div
        className="absolute bottom-[22px] right-4 rounded-[13px] border border-ink/10 flex items-center p-1 gap-px"
        style={{
          background: 'rgba(253,250,245,0.96)',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 4px 18px rgba(26,21,16,0.09)',
          zIndex: 180000,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => bumpZoom(-1)}
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
          onClick={() => bumpZoom(1)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/50 hover:bg-ink/10 transition-colors"
          title="Zoom in"
        ><PlusIcon size={14} /></button>
      </div>
    </div>
  );
});

export default Canvas;
