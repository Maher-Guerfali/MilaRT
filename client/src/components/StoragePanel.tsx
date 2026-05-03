import { useState, useEffect } from 'react';
import type { BaseItem, ImageData, LinkData } from '../types';
import { LinkIcon, TrashIcon } from './icons';

interface Props {
  items: BaseItem[];
  onRestoreToCanvasCenter: (id: string) => void;
  onDelete: (id: string) => void;
}

export const STORAGE_RESTORE_MIME = 'application/milart-storage-restore';

export default function StoragePanel({ items, onRestoreToCanvasCenter, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverDrop, setHoverDrop] = useState(false);

  // Auto-open briefly when an item is added while collapsed, so the user sees where it went.
  const count = items.length;
  const [prevCount, setPrevCount] = useState(count);
  useEffect(() => {
    if (count > prevCount && !open) {
      setOpen(true);
      const t = setTimeout(() => setOpen(false), 1800);
      return () => clearTimeout(t);
    }
    setPrevCount(count);
  }, [count, open, prevCount]);

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(STORAGE_RESTORE_MIME, id);
  }

  return (
    <aside
      data-storage-drop="true"
      className="shrink-0 h-full bg-paper border-l border-ink/10 flex z-10 transition-[width] duration-200 ease-out overflow-hidden"
      style={{
        width: open ? 296 : 36,
        background: hoverDrop ? 'rgba(217,116,53,0.08)' : undefined,
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('application/milart-canvas-item')) setHoverDrop(true);
      }}
      onDragLeave={() => setHoverDrop(false)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/milart-canvas-item')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={() => setHoverDrop(false)}
    >
      {/* Vertical tab — collapsed handle */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Close storage' : 'Open storage'}
        className="h-full flex items-center justify-center hover:bg-ink/5 transition-colors shrink-0"
        style={{
          width: 36,
          minWidth: 36,
          borderRight: open ? '1px solid rgba(26,21,16,0.10)' : 'none',
          cursor: 'pointer',
        }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/55 select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' }}
        >
          Storage{count > 0 ? ` · ${count}` : ''}
        </span>
      </button>

      {/* Body */}
      <div
        className="flex-1 min-w-0 flex flex-col"
        style={{ visibility: open ? 'visible' : 'hidden' }}
      >
        <div className="px-3 py-3 border-b border-ink/10 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink/55">
            Storage
          </span>
          <span className="text-[10px] text-ink/40">{count} item{count === 1 ? '' : 's'}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start">
          {items.length === 0 && (
            <div className="col-span-2 text-center text-[10.5px] text-ink/45 py-8 px-3 leading-relaxed">
              <div className="mb-2 text-[18px]">📦</div>
              Drag images or links here<br />
              to keep them off the canvas.
              <div className="mt-3 text-[9.5px] text-ink/30 leading-relaxed">
                Click a card to send it back<br />
                to the canvas centre.
              </div>
            </div>
          )}
          {items.map((it) => (
            <StorageCard
              key={it.id}
              item={it}
              onDragStart={onDragStart}
              onRestore={() => onRestoreToCanvasCenter(it.id)}
              onDelete={() => onDelete(it.id)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function StorageCard({
  item,
  onDragStart,
  onRestore,
  onDelete,
}: {
  item: BaseItem;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const isImage = item.type === 'image';
  const imgUrl = isImage ? (item.data as Partial<ImageData>).url : null;
  const link = !isImage ? (item.data as Partial<LinkData>) : null;
  const linkText = link?.title || link?.url || 'Untitled';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      onClick={onRestore}
      title="Click to restore to canvas — or drag onto the canvas"
      className="group relative rounded-lg overflow-hidden bg-white ring-1 ring-ink/10 hover:ring-amber/60 hover:shadow-md transition-all cursor-grab active:cursor-grabbing"
      style={{ aspectRatio: isImage ? '1' : 'auto' }}
    >
      {isImage && imgUrl && (
        <img
          src={imgUrl}
          alt=""
          draggable={false}
          className="w-full h-full object-cover pointer-events-none"
        />
      )}
      {!isImage && (
        <div className="w-full p-2 flex items-start gap-1.5 text-[10.5px] text-ink leading-snug min-h-[52px]">
          <LinkIcon size={11} />
          <span className="line-clamp-3 break-all">{linkText}</span>
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-ink/80 text-paper opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
        title="Delete"
      >
        <TrashIcon size={10} />
      </button>
    </div>
  );
}
