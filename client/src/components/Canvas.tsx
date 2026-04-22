import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem } from '../types';
import { api } from '../api';
import ItemView from './ItemView';

interface Props {
  items: BaseItem[];
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  onDelete: (id: string) => void;
  onAdd: (item: BaseItem) => void;
  onEnterBoard: (itemId: string) => void;
}

export default function Canvas({ items, onUpdate, onDelete, onAdd, onEnterBoard }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  // Translate screen coords to board (world) coords.
  function toWorld(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  // Middle-mouse or spacebar-like panning: here we pan on background left-drag.
  function onBgPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-item]')) return;
    setSelected(null);
    setPanning(true);
    panStart.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBgPointerMove(e: React.PointerEvent) {
    if (!panning || !panStart.current) return;
    setView((v) => ({
      ...v,
      x: panStart.current!.vx + (e.clientX - panStart.current!.px),
      y: panStart.current!.vy + (e.clientY - panStart.current!.py),
    }));
  }
  function onBgPointerUp(e: React.PointerEvent) {
    setPanning(false);
    panStart.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

  // Zoom with Ctrl/Cmd + wheel, pan with plain wheel/trackpad.
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
      setView({
        scale: next,
        x: cx - worldX * next,
        y: cy - worldY * next,
      });
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  // Global paste handler: images become image items, text becomes a sticky.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      // Don't hijack paste while typing in an input.
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
        const img = new Image();
        img.onload = () => {
          const maxW = 360;
          const scale = Math.min(1, maxW / img.width);
          onAdd({
            id: nanoid(10),
            type: 'image',
            x: pos.x - (img.width * scale) / 2,
            y: pos.y - (img.height * scale) / 2,
            w: img.width * scale,
            h: img.height * scale,
            z: 0,
            data: { url },
          });
        };
        img.src = url;
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

  // Delete key removes the selected item (unless typing in a field).
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

  function centerOfView() {
    const rect = wrapRef.current!.getBoundingClientRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 board-bg no-select"
      style={{ cursor: panning ? 'grabbing' : 'grab' }}
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onPointerCancel={onBgPointerUp}
      onWheel={onWheel}
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
            onSelect={() => setSelected(it.id)}
            onUpdate={(patch) => onUpdate(it.id, patch)}
            onDelete={() => onDelete(it.id)}
            onEnterBoard={() => onEnterBoard(it.id)}
          />
        ))}
      </div>

      <div className="absolute bottom-3 right-3 text-xs text-ink/50 bg-white/70 rounded px-2 py-1">
        {Math.round(view.scale * 100)}%
      </div>
    </div>
  );
}
