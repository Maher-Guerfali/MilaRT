import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem, Stroke } from '../types';
import { api } from '../api';
import ItemView from './ItemView';
import StrokeLayer from './StrokeLayer';

interface Props {
  items: BaseItem[];
  strokes: Stroke[];
  drawMode: boolean;
  drawColor: string;
  drawWidth: number;
  eraser: boolean;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  onDelete: (id: string) => void;
  onAdd: (item: BaseItem) => void;
  onSetStrokes: (next: Stroke[]) => void;
  onEnterBoard: (itemId: string) => void;
}

export default function Canvas({
  items, strokes, drawMode, drawColor, drawWidth, eraser,
  onUpdate, onDelete, onAdd, onSetStrokes, onEnterBoard,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

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

  // Pan when the user drags on empty background (and not in draw mode).
  function onBgPointerDown(e: React.PointerEvent) {
    if (drawMode) return;
    if ((e.target as HTMLElement).closest('[data-item]')) return;
    setSelected(null);
    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    // Capture the snapshot synchronously so the queued setState can't see a null.
    const ps = panStart.current;
    if (!panning || !ps) return;
    const dx = e.clientX - ps.px;
    const dy = e.clientY - ps.py;
    setView((v) => ({ ...v, x: ps.vx + dx, y: ps.vy + dy }));
  }
  function onBgPointerUp(e: React.PointerEvent) {
    setPanning(false);
    panStart.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      const next = Math.min(2.5, Math.max(0.25, view.scale * (1 + delta)));
      const rect = wrapRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const worldX = (cx - view.x) / view.scale;
      const worldY = (cy - view.y) / view.scale;
      setView({ scale: next, x: cx - worldX * next, y: cy - worldY * next });
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  // Drop a file from desktop -> upload -> create image item at the cursor.
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const pos = toWorld(e.clientX, e.clientY);
    for (const file of files) {
      try {
        const { url } = await api.uploadImage(file);
        await placeImage(url, pos.x, pos.y);
        pos.x += 30; pos.y += 30; // stagger if multiple
      } catch (err) {
        console.error('upload failed', err);
      }
    }
  }

  async function placeImage(url: string, cx: number, cy: number) {
    const img = new Image();
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = url; });
    const maxW = 360;
    const scale = Math.min(1, maxW / img.width);
    onAdd({
      id: nanoid(10),
      type: 'image',
      x: cx - (img.width * scale) / 2,
      y: cy - (img.height * scale) / 2,
      w: img.width * scale,
      h: img.height * scale,
      z: 0,
      data: { url },
    });
  }

  // Paste images from the clipboard or text into a sticky/link.
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
        const { url } = await api.uploadImage(file);
        const pos = centerOfView();
        await placeImage(url, pos.x, pos.y);
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
          h: isUrl ? 90 : 160,
          z: 0,
          data: isUrl ? { url: text.trim(), title: text.trim() } : { text, color: '#fff7ae' },
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        onDelete(selected);
        setSelected(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onDelete]);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 board-bg no-select ${dragOver ? 'ring-4 ring-inset ring-blue-400/50' : ''}`}
      style={{ cursor: drawMode ? 'crosshair' : panning ? 'grabbing' : 'grab' }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onPointerCancel={onBgPointerUp}
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
            selected={selected === it.id}
            scale={view.scale}
            interactive={!drawMode}
            onSelect={() => setSelected(it.id)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
          />
        ))}
      </div>

      {/* Stroke layer always renders on top of items in world space. */}
      <StrokeLayer
        view={view}
        strokes={strokes}
        drawMode={drawMode}
        color={drawColor}
        width={drawWidth}
        eraser={eraser}
        onChange={onSetStrokes}
        toWorld={toWorld}
      />

      <div className="absolute bottom-3 right-3 text-xs text-ink/50 bg-white/70 rounded px-2 py-1 pointer-events-none">
        {Math.round(view.scale * 100)}%
      </div>
    </div>
  );
}
