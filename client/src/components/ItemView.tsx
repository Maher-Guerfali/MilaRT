import { useRef, useState } from 'react';
import type { BaseItem, StickyData, ImageData, LinkData, BoardRefData } from '../types';
import { GripIcon, TrashIcon } from './icons';

interface Props {
  item: BaseItem;
  selected: boolean;
  scale: number;
  interactive: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onDelete: () => void;
  onEnterBoard: () => void;
}

export default function ItemView({
  item, selected, scale, interactive, onSelect, onUpdate, onDelete, onEnterBoard,
}: Props) {
  const dragRef = useRef<{ px: number; py: number; ix: number; iy: number; iw: number; ih: number; mode: 'move' | 'resize' } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  function startDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
    if (!interactive) return;
    e.stopPropagation();
    onSelect();
    dragRef.current = {
      px: e.clientX, py: e.clientY,
      ix: item.x, iy: item.y,
      iw: item.w, ih: item.h,
      mode,
    };
    setGhost({ x: item.x, y: item.y, w: item.w, h: item.h });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / scale;
    const dy = (e.clientY - d.py) / scale;
    if (d.mode === 'move') {
      setGhost({ x: d.ix + dx, y: d.iy + dy, w: d.iw, h: d.ih });
    } else {
      setGhost({ x: d.ix, y: d.iy, w: Math.max(80, d.iw + dx), h: Math.max(60, d.ih + dy) });
    }
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !ghost) return;
    if (d.mode === 'move') onUpdate({ x: ghost.x, y: ghost.y });
    else onUpdate({ w: ghost.w, h: ghost.h });
    dragRef.current = null;
    setGhost(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

  const pos = ghost ?? item;
  const ringCls = selected ? 'ring-2 ring-ink/60' : 'ring-1 ring-black/5';

  return (
    <div
      data-item
      className={`group absolute rounded-xl shadow-sm bg-white ${ringCls}`}
      style={{
        left: pos.x, top: pos.y, width: pos.w, height: pos.h,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => {
        if (item.type === 'board') { e.stopPropagation(); onEnterBoard(); }
      }}
    >
      {item.type === 'sticky' && <Sticky item={item} onUpdate={onUpdate} />}
      {item.type === 'image' && <ImageBox item={item} />}
      {item.type === 'link' && <LinkBox item={item} onUpdate={onUpdate} />}
      {item.type === 'board' && <BoardRefBox item={item} onUpdate={onUpdate} onEnter={onEnterBoard} />}

      {/* Drag handle — top-left grip, only this initiates a move */}
      <button
        title="Drag"
        className={`absolute -top-2 -left-2 w-7 h-7 rounded-full bg-white shadow ring-1 ring-black/10 flex items-center justify-center text-ink/60 hover:text-ink cursor-grab active:cursor-grabbing transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onPointerDown={(e) => startDrag(e, 'move')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripIcon size={14} />
      </button>

      {selected && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-ink text-paper shadow flex items-center justify-center"
          title="Delete"
        ><TrashIcon size={14} /></button>
      )}

      {/* Resize handle is visible whenever the item is hovered or selected,
          so it works without first clicking-to-select (a common confusion). */}
      <div
        className={`absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-white shadow ring-1 ring-black/10 flex items-center justify-center text-ink/60 cursor-se-resize transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        onPointerDown={(e) => startDrag(e, 'resize')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Resize"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 21 21 9" /><path d="M14 21 21 14" /><path d="M19 21 21 19" />
        </svg>
      </div>
    </div>
  );
}

function Sticky({ item, onUpdate }: { item: BaseItem; onUpdate: (p: Partial<BaseItem>) => void }) {
  const d = item.data as Partial<StickyData>;
  return (
    <textarea
      className="w-full h-full resize-none rounded-xl p-3 text-sm leading-snug bg-transparent focus:outline-none"
      placeholder="Type something…"
      value={d.text ?? ''}
      onChange={(e) => onUpdate({ data: { ...d, text: e.target.value } })}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ background: d.color || '#fff7ae', borderRadius: 12 }}
    />
  );
}

function ImageBox({ item }: { item: BaseItem }) {
  const d = item.data as Partial<ImageData>;
  if (!d.url) return <div className="w-full h-full flex items-center justify-center text-ink/40 text-sm">No image</div>;
  return (
    <img
      src={d.url}
      alt=""
      draggable={false}
      className="w-full h-full object-cover rounded-xl pointer-events-none"
    />
  );
}

function LinkBox({ item, onUpdate }: { item: BaseItem; onUpdate: (p: Partial<BaseItem>) => void }) {
  const d = item.data as Partial<LinkData>;
  const isUrl = d.url && /^https?:\/\//i.test(d.url);
  return (
    <div className="w-full h-full p-3 flex flex-col gap-1">
      <input
        className="w-full bg-transparent text-sm font-medium focus:outline-none"
        placeholder="Title"
        value={d.title ?? ''}
        onChange={(e) => onUpdate({ data: { ...d, title: e.target.value } })}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <input
        className="w-full bg-transparent text-xs text-ink/60 focus:outline-none"
        placeholder="https://…"
        value={d.url ?? ''}
        onChange={(e) => onUpdate({ data: { ...d, url: e.target.value } })}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {isUrl && (
        <a
          href={d.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline mt-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >Open link ↗</a>
      )}
    </div>
  );
}

function BoardRefBox({ item, onUpdate, onEnter }: { item: BaseItem; onUpdate: (p: Partial<BaseItem>) => void; onEnter: () => void }) {
  const d = item.data as Partial<BoardRefData>;
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 rounded-t-xl bg-ink/5 flex items-center justify-center text-ink/30">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </div>
      <div className="px-3 py-2 flex items-center gap-2 border-t border-black/5">
        <input
          className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
          value={d.name ?? ''}
          placeholder="Board name"
          onChange={(e) => onUpdate({ data: { ...d, name: e.target.value } })}
          onPointerDown={(e) => e.stopPropagation()}
        />
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEnter(); }}
          className="text-xs rounded-md border border-ink/20 px-2 py-1 hover:bg-ink hover:text-paper"
        >Open</button>
      </div>
    </div>
  );
}
