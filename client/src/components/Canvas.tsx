import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem, Stroke } from '../types';
import { api } from '../api';
import ItemView from './ItemView';
import StrokeLayer from './StrokeLayer';
import type { Mode } from './DrawToolbar';

interface Props {
  items: BaseItem[];
  strokes: Stroke[];
  mode: Mode;
  drawColor: string;
  drawWidth: number;
  penOnly: boolean;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  onDelete: (id: string) => void;
  onAdd: (item: BaseItem) => void;
  onSetStrokes: (next: Stroke[]) => void;
  onEnterBoard: (itemId: string) => void;
}

// Zoom is intentionally locked at 1 for now — the variable scale path was
// causing confusion and an unrelated zoom bug. Pan still works.
const SCALE = 1;

export default function Canvas({
  items, strokes, mode, drawColor, drawWidth, penOnly,
  onUpdate, onDelete, onAdd, onSetStrokes, onEnterBoard,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  const drawMode = mode !== 'drag';
  const eraser = mode === 'erase';
  const interactive = mode === 'drag';

  function toWorld(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left - pan.x, y: clientY - rect.top - pan.y };
  }
  function centerOfView() {
    const rect = wrapRef.current!.getBoundingClientRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function onBgPointerDown(e: React.PointerEvent) {
    if (drawMode) return;
    if ((e.target as HTMLElement).closest('[data-item]')) return;
    setSelected(null);
    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: pan.x, vy: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    const ps = panStart.current;
    if (!panning || !ps) return;
    const dx = e.clientX - ps.px;
    const dy = e.clientY - ps.py;
    setPan({ x: ps.vx + dx, y: ps.vy + dy });
  }
  function onBgPointerUp(e: React.PointerEvent) {
    setPanning(false);
    panStart.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

  // Wheel pans the board. Zoom (Ctrl+wheel) intentionally disabled for now.
  function onWheel(e: React.WheelEvent) {
    setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  }

  // Add an image item with a sane default size and let the browser load it
  // in place. Avoids "nothing happens" when the URL 404s — at least a card
  // appears so the user can see the broken state and delete it.
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
      onWheel={onWheel}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div
        className="absolute origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        {items.map((it) => (
          <ItemView
            key={it.id}
            item={it}
            selected={selected === it.id}
            scale={SCALE}
            interactive={interactive}
            onSelect={() => setSelected(it.id)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
          />
        ))}
      </div>

      <StrokeLayer
        view={{ x: pan.x, y: pan.y, scale: SCALE }}
        strokes={strokes}
        drawMode={drawMode}
        color={drawColor}
        width={drawWidth}
        eraser={eraser}
        penOnly={penOnly}
        onChange={onSetStrokes}
        toWorld={toWorld}
      />
    </div>
  );
}
