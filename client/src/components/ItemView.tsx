import { useRef, useState } from 'react';
import type { BaseItem, StickyData, ImageData, LinkData, BoardRefData } from '../types';
import { api } from '../api';
import { GripIcon, TrashIcon, BoardIcon, CameraIcon, EnterChevron, LinkIcon, ImageIcon } from './icons';

interface Props {
  item: BaseItem;
  selected: boolean;
  selectionIds: string[];
  scale: number;
  interactive: boolean;
  onSelect: (additive: boolean) => void;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onMoveGroup: (ids: string[], dx: number, dy: number) => void;
  onDelete: () => void;
  onEnterBoard: () => void;
}

export default function ItemView({
  item, selected, selectionIds, scale, interactive, onSelect, onUpdate, onMoveGroup, onDelete, onEnterBoard,
}: Props) {
  const dragRef = useRef<{ px: number; py: number; ix: number; iy: number; iw: number; ih: number; mode: 'move' | 'resize' } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastDelta = useRef<{ dx: number; dy: number } | null>(null);

  function startDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
    if (!interactive) return;
    e.stopPropagation();
    if (!selected || mode === 'resize') onSelect(e.shiftKey);
    dragRef.current = {
      px: e.clientX, py: e.clientY,
      ix: item.x, iy: item.y,
      iw: item.w, ih: item.h,
      mode,
    };
    lastDelta.current = { dx: 0, dy: 0 };
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
      if (selectionIds.length > 1 && selectionIds.includes(item.id) && lastDelta.current) {
        const idx = dx - lastDelta.current.dx;
        const idy = dy - lastDelta.current.dy;
        if (idx !== 0 || idy !== 0) {
          onMoveGroup(selectionIds.filter((id) => id !== item.id), idx, idy);
          lastDelta.current = { dx, dy };
        }
      }
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
    lastDelta.current = null;
    setGhost(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const pos = ghost ?? item;

  return (
    <div
      data-item
      className="group absolute"
      style={{
        left: pos.x, top: pos.y, width: pos.w, height: pos.h,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(e.shiftKey); }}
    >
      {item.type === 'sticky' && <Sticky item={item} selected={selected} onUpdate={onUpdate} />}
      {item.type === 'image'  && <ImageBox item={item} selected={selected} />}
      {item.type === 'link'   && <TextOrLink item={item} selected={selected} onUpdate={onUpdate} />}
      {item.type === 'board'  && <BoardRefBox item={item} selected={selected} onUpdate={onUpdate} onEnter={onEnterBoard} />}

      {/* Drag grip — only visible on hover/select */}
      <button
        title="Drag"
        className={`absolute -top-2 -left-2 w-7 h-7 rounded-full bg-white shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/60 hover:text-ink cursor-grab active:cursor-grabbing transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
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
          className="absolute -top-2.5 -right-2.5 w-[26px] h-[26px] rounded-full bg-ink text-paper shadow flex items-center justify-center"
          title="Delete"
        ><TrashIcon size={14} /></button>
      )}

      <div
        className={`absolute -bottom-2 -right-2 w-6 h-6 rounded-full bg-white shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/60 cursor-se-resize transition-opacity ${
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

function Sticky({
  item, selected, onUpdate,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void }) {
  const d = item.data as Partial<StickyData>;
  return (
    <textarea
      className="w-full h-full resize-none border-0 outline-none p-[13px_15px] text-[12.5px] leading-[1.7] text-ink whitespace-pre-wrap transition-shadow"
      placeholder="Type something…"
      value={d.text ?? ''}
      onChange={(e) => onUpdate({ data: { ...d, text: e.target.value } })}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        background: d.color || '#FFF3C4',
        borderRadius: 16,
        boxShadow: selected
          ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)'
          : '0 2px 10px rgba(26,21,16,0.09)',
      }}
    />
  );
}

function ImageBox({ item, selected }: { item: BaseItem; selected: boolean }) {
  const d = item.data as Partial<ImageData>;
  if (!d.url) {
    return (
      <div
        className="w-full h-full rounded-2xl flex flex-col items-center justify-center gap-2 text-ink/50 transition-shadow"
        style={{
          background: 'linear-gradient(135deg, rgba(26,21,16,0.04), rgba(232,184,48,0.10))',
          border: '2px dashed rgba(26,21,16,0.14)',
          boxShadow: selected ? '0 0 0 2.5px #D97435' : 'none',
        }}
      >
        <ImageIcon size={26} />
        <span className="text-[11px]">Drop image / paste URL</span>
      </div>
    );
  }
  return (
    <img
      src={d.url}
      alt=""
      draggable={false}
      className="w-full h-full object-cover rounded-2xl pointer-events-none"
      style={{ boxShadow: selected ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)' : '0 2px 10px rgba(26,21,16,0.09)' }}
    />
  );
}

// "link"-typed items render as either bare text (when there's no URL)
// or a subtle blue-underlined link card.
function TextOrLink({
  item, selected, onUpdate,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void }) {
  const d = item.data as Partial<LinkData>;
  const txt = (d.title || d.url || '').toString();
  const isUrl = /^https?:\/\/\S+$/i.test(txt.trim());
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <textarea
        autoFocus
        className="w-full h-full resize-none p-1.5 text-[14px] leading-snug bg-paper rounded-lg outline outline-2 outline-amber"
        value={txt}
        placeholder="Type text or paste a link…"
        onChange={(e) => onUpdate({ data: { url: '', title: e.target.value } })}
        onBlur={() => setEditing(false)}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  // Compact URL card
  if (isUrl) {
    return (
      <div
        className="w-full h-full flex items-center gap-2 px-3 transition-all rounded-lg"
        style={{
          background: selected ? 'rgba(217,116,53,0.08)' : 'rgba(26,21,16,0.04)',
          border: `1px solid ${selected ? '#D97435' : 'rgba(26,21,16,0.10)'}`,
        }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      >
        <LinkIcon size={13} />
        <a
          href={txt.trim()}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-blue-600 underline overflow-hidden text-ellipsis whitespace-nowrap"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >{txt}</a>
      </div>
    );
  }

  // Bare text
  return (
    <div
      className="w-full h-full text-ink whitespace-pre-wrap cursor-text rounded-lg p-1.5 transition-shadow"
      style={{
        fontSize: 16, fontWeight: 700, lineHeight: 1.45, letterSpacing: '-0.2px',
        boxShadow: selected ? '0 0 0 2px #D97435' : 'none',
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {txt || <span className="text-ink/50 italic font-medium">empty text…</span>}
    </div>
  );
}

function BoardRefBox({
  item, selected, onUpdate, onEnter,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void; onEnter: () => void }) {
  const d = item.data as Partial<BoardRefData>;
  const fileRef = useRef<HTMLInputElement>(null);
  const [hov, setHov] = useState(false);
  const highlight = selected;

  async function uploadCover(file: File) {
    try {
      const { url } = await api.uploadImage(file);
      onUpdate({ data: { ...d, imageUrl: url } });
    } catch (err) {
      alert('Image upload failed: ' + (err as Error).message);
    }
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div
        className="w-full flex-1 min-h-0 rounded-[18px] flex items-center justify-center relative overflow-hidden transition-all"
        style={{
          background: '#FDFAF5',
          border: `2px solid ${highlight ? '#D97435' : hov ? 'rgba(26,21,16,0.22)' : 'rgba(26,21,16,0.10)'}`,
          boxShadow: highlight
            ? '0 0 0 3px rgba(217,116,53,0.19)'
            : hov ? '0 4px 18px rgba(26,21,16,0.10)' : '0 2px 8px rgba(26,21,16,0.06)',
        }}
      >
        {d.imageUrl ? (
          <img src={d.imageUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
        ) : (
          <div className="text-ink/50">
            <BoardIcon size={30} />
          </div>
        )}

        {/* Faded "Enter →" chip — always visible at 28%, full on hover/select */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEnter(); }}
          className="absolute bottom-2 right-2 flex items-center gap-1 px-[9px] py-[4px] rounded-full border-0 cursor-pointer text-[10px] font-bold tracking-[0.05em] transition-opacity"
          style={{
            background: 'rgba(217,116,53,0.13)',
            color: '#D97435',
            opacity: highlight || hov ? 1 : 0.28,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(217,116,53,0.24)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(217,116,53,0.13)'; }}
        >
          Enter <EnterChevron size={12} />
        </button>

        {/* Hover-reveal upload thumbnail button */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/90 shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/70 hover:text-ink opacity-0 group-hover:opacity-100"
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
        className="w-full mt-[7px] bg-transparent text-[12px] font-bold text-ink text-center focus:outline-none rounded-md px-1 py-0.5 hover:bg-white/50 focus:bg-white/80"
        value={d.name ?? ''}
        placeholder="Board name"
        onChange={(e) => onUpdate({ data: { ...d, name: e.target.value } })}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
