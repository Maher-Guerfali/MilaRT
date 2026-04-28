import { useRef, useState } from 'react';
import type { BaseItem, StickyData, ImageData, LinkData, BoardRefData } from '../types';
import { api } from '../api';
import { GripIcon, TrashIcon, BoardIcon, CameraIcon } from './icons';

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
      setGhost({ x: d.ix, y: d.iy, w: Math.max(60, d.iw + dx), h: Math.max(40, d.ih + dy) });
    }
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !ghost) return;
    if (d.mode === 'move') onUpdate({ x: ghost.x, y: ghost.y });
    else onUpdate({ w: ghost.w, h: ghost.h });
    dragRef.current = null;
    setGhost(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const pos = ghost ?? item;

  // Link items render as bare text (no card). Other items keep the white
  // card + ring; Board ref renders its own visual.
  const isText = item.type === 'link';
  const isBoard = item.type === 'board';
  const ringCls = selected ? 'ring-2 ring-ink/60' : 'ring-1 ring-black/5';
  const bodyCls =
    isText
      ? '' // transparent body
      : isBoard
        ? '' // board ref has its own styling
        : `rounded-xl shadow-sm bg-white ${ringCls}`;

  return (
    <div
      data-item
      className={`group absolute ${bodyCls}`}
      style={{
        left: pos.x, top: pos.y, width: pos.w, height: pos.h,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {item.type === 'sticky' && <Sticky item={item} onUpdate={onUpdate} />}
      {item.type === 'image' && <ImageBox item={item} />}
      {item.type === 'link' && <TextBox item={item} selected={selected} onUpdate={onUpdate} />}
      {item.type === 'board' && (
        <BoardRefBox item={item} selected={selected} onUpdate={onUpdate} onEnter={onEnterBoard} />
      )}

      {/* Drag grip — only this initiates a move so the body stays interactive. */}
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

// Bare text item: no background, no card. Just typed text on the canvas.
// URLs in the text are clickable when not focused.
function TextBox({
  item, selected, onUpdate,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void }) {
  const d = item.data as Partial<LinkData>;
  // Backwards compat — earlier versions stored {url, title}; merge them into a single string on first edit.
  const initial = (d.title || d.url || '').toString();
  const [editing, setEditing] = useState(false);
  const isUrl = /^https?:\/\/\S+$/i.test(initial.trim());

  if (editing) {
    return (
      <textarea
        autoFocus
        className={`w-full h-full resize-none p-1 text-sm leading-snug bg-transparent focus:outline-none rounded ${selected ? 'ring-1 ring-ink/30' : ''}`}
        value={initial}
        placeholder="Type text or paste a link…"
        onChange={(e) => onUpdate({ data: { url: '', title: e.target.value } })}
        onBlur={() => setEditing(false)}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={`w-full h-full p-1 text-sm leading-snug whitespace-pre-wrap break-words ${
        isUrl ? 'text-blue-700 underline' : 'text-ink'
      }`}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onClick={(e) => {
        if (isUrl && (e.metaKey || e.ctrlKey)) {
          e.stopPropagation();
          window.open(initial.trim(), '_blank', 'noopener,noreferrer');
        }
      }}
      title={isUrl ? 'Cmd/Ctrl-click to open. Double-click to edit.' : 'Double-click to edit.'}
    >
      {initial || <span className="text-ink/40 italic">empty text…</span>}
    </div>
  );
}

// Board ref: small rounded square + label below. Click the square to open.
// When selected, hover-reveal a camera button to upload a custom thumbnail.
function BoardRefBox({
  item, selected, onUpdate, onEnter,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void; onEnter: () => void }) {
  const d = item.data as Partial<BoardRefData>;
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadCover(file: File) {
    try {
      const { url } = await api.uploadImage(file);
      onUpdate({ data: { ...d, imageUrl: url } });
    } catch (err) {
      alert('Image upload failed: ' + (err as Error).message);
    }
  }

  // Square fills the available width with a fixed aspect ratio (1:1).
  // Label sits below at the bottom of the item.
  return (
    <div className="w-full h-full flex flex-col items-center">
      <div className="relative w-full flex-1 min-h-0">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEnter(); }}
          className={`absolute inset-0 rounded-xl overflow-hidden flex items-center justify-center transition-shadow ${
            selected ? 'ring-2 ring-ink/60' : 'ring-1 ring-black/10 hover:ring-ink/40'
          }`}
          style={{
            background: d.imageUrl ? 'transparent' : '#ffffff',
          }}
          title={d.name ? `Open "${d.name}"` : 'Open board'}
        >
          {d.imageUrl ? (
            <img src={d.imageUrl} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
          ) : (
            <BoardIcon size={Math.min(48, Math.max(20, item.w * 0.4))} />
          )}
        </button>

        {/* Hover-reveal upload button to set a custom thumbnail. */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          className="absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 shadow ring-1 ring-black/10 flex items-center justify-center text-ink/70 hover:text-ink opacity-0 group-hover:opacity-100"
          title="Set thumbnail"
        ><CameraIcon size={14} /></button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) uploadCover(f);
          }}
        />
      </div>

      <input
        className="w-full mt-1 bg-transparent text-xs text-center font-medium focus:outline-none rounded px-1 py-0.5 hover:bg-white/50 focus:bg-white/80"
        value={d.name ?? ''}
        placeholder="Board name"
        onChange={(e) => onUpdate({ data: { ...d, name: e.target.value } })}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
