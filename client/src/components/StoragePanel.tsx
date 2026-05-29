import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BaseItem, ImageData, LinkData, BoardRefData, PDFData } from '../types';
import { LinkIcon, TrashIcon, BoardIcon } from './icons';

interface Props {
  items: BaseItem[];
  onRestoreToCanvasCenter: (id: string) => void;
  onDelete: (id: string) => void;
}

export const STORAGE_RESTORE_MIME = 'application/milart-storage-restore';

export default function StoragePanel({ items, onRestoreToCanvasCenter, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [hoverDrop, setHoverDrop] = useState(false);

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
      {/* Vertical tab handle */}
      <div
        className="h-full flex flex-col items-center shrink-0"
        style={{ width: 36, minWidth: 36, borderRight: open ? '1px solid rgba(26,21,16,0.10)' : 'none' }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Close storage' : 'Open storage'}
          className="mt-3 px-1.5 py-2 rounded-md hover:bg-ink/10 transition-colors"
        >
          <span
            className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink/55 select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' }}
          >
            Storage{count > 0 ? ` · ${count}` : ''}
          </span>
        </button>
      </div>

      {/* Body */}
      <div
        className="flex-1 min-w-0 flex flex-col"
        style={{ visibility: open ? 'visible' : 'hidden' }}
      >
        <div className="px-3 py-3 border-b border-ink/10 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink/55">Storage</span>
          <span className="text-[10px] text-ink/40">{count} item{count === 1 ? '' : 's'}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-3 content-start">
          {items.length === 0 && (
            <div className="col-span-2 text-center text-[10.5px] text-ink/45 py-8 px-3 leading-relaxed">
              <div className="mb-2 text-[18px]">📦</div>
              Drag images, PDFs, links or boards here<br />
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

// ── Download helper ────────────────────────────────────────────────────────
async function downloadFileFromUrl(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch {
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Context menu ───────────────────────────────────────────────────────────
function StorageCardMenu({
  item, x, y, onClose, onDelete,
}: {
  item: BaseItem; x: number; y: number; onClose: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let nx = x, ny = y;
    if (nx + rect.width + pad > window.innerWidth) nx = window.innerWidth - rect.width - pad;
    if (ny + rect.height + pad > window.innerHeight) ny = window.innerHeight - rect.height - pad;
    if (nx !== x || ny !== y) setPos({ x: Math.max(pad, nx), y: Math.max(pad, ny) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [onClose]);

  function run(action: () => void) {
    return (e: React.MouseEvent) => { e.stopPropagation(); onClose(); action(); };
  }

  const isImage = item.type === 'image';
  const isBoard = item.type === 'board';
  const isPDF = item.type === 'pdf';
  const imgUrl = isImage ? (item.data as Partial<ImageData>).url : null;
  const linkUrl = !isImage && !isBoard && !isPDF ? ((item.data as Partial<LinkData>).url || (item.data as Partial<LinkData>).title || '') : null;
  const boardData = isBoard ? item.data as (Partial<BoardRefData> & { boardSnapshot?: { items: BaseItem[]; strokes: unknown[]; name: string } }) : null;
  const pdfData = isPDF ? item.data as Partial<PDFData> : null;

  const menuItems: Array<{ label: string; icon: React.ReactNode; action: () => void; danger?: boolean }> = [
    ...(isImage && imgUrl ? [{
      label: 'Download image',
      icon: <DownIcon />,
      action: () => {
        const filename = imgUrl.split('/').pop()?.split('?')[0] || 'image.png';
        void downloadFileFromUrl(imgUrl, filename);
      },
    }] : []),
    ...(linkUrl ? [{
      label: 'Open in new tab',
      icon: <ExternalIcon />,
      action: () => { window.open(linkUrl, '_blank', 'noopener,noreferrer'); },
    }] : []),
    ...(linkUrl ? [{
      label: 'Copy URL',
      icon: <LinkIcon size={13} />,
      action: () => { void navigator.clipboard?.writeText(linkUrl); },
    }] : []),
    ...(isPDF && pdfData?.url ? [{
      label: 'Open PDF',
      icon: <ExternalIcon />,
      action: () => { window.open(pdfData.url, '_blank', 'noopener,noreferrer'); },
    }, {
      label: 'Download PDF',
      icon: <DownIcon />,
      action: () => { void downloadFileFromUrl(pdfData.url!, pdfData.name || 'document.pdf'); },
    }] : []),
    ...(isBoard ? [{
      label: 'Export board as JSON',
      icon: <DownIcon />,
      action: () => {
        const snapshot = boardData?.boardSnapshot;
        const name = boardData?.name || 'board';
        const payload = snapshot
          ? { name, items: snapshot.items, strokes: snapshot.strokes }
          : { name, items: [], strokes: [] };
        downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${name}.json`);
      },
    }] : []),
    {
      label: 'Delete from storage',
      icon: <TrashIcon size={13} />,
      action: onDelete,
      danger: true,
    },
  ];

  return createPortal(
    <div
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[100000] min-w-[190px] py-1 rounded-xl text-[12px] text-ink"
      style={{
        left: pos.x, top: pos.y,
        background: 'rgba(253,250,245,0.98)',
        border: '1px solid rgba(26,21,16,0.10)',
        boxShadow: '0 10px 28px rgba(26,21,16,0.18), 0 2px 6px rgba(26,21,16,0.10)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {menuItems.map((it, i) => (
        <button
          key={i}
          onClick={run(it.action)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-ink/[0.06] transition-colors"
          style={it.danger ? { color: '#C0392B' } : undefined}
        >
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-current">{it.icon}</span>
          <span className="flex-1">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

// ── StorageCard ────────────────────────────────────────────────────────────
function StorageCard({
  item, onDragStart, onRestore, onDelete,
}: {
  item: BaseItem;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const isImage = item.type === 'image';
  const isBoard = item.type === 'board';
  const isPDF = item.type === 'pdf';
  const imgUrl = isImage ? (item.data as Partial<ImageData>).url : null;
  const link = !isImage && !isBoard && !isPDF ? (item.data as Partial<LinkData>) : null;
  const linkText = link?.title || link?.url || 'Untitled';
  const boardData = isBoard
    ? item.data as (Partial<BoardRefData> & { boardSnapshot?: { items: BaseItem[]; strokes: unknown[]; name: string } })
    : null;
  const boardItemCount = boardData?.boardSnapshot?.items?.length ?? null;
  const pdfData = isPDF ? item.data as Partial<PDFData> : null;

  return (
    <>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, item.id)}
        onClick={onRestore}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        title="Click to restore to canvas — or drag onto the canvas. Right-click to export."
        className="group relative rounded-xl overflow-hidden bg-white ring-1 ring-ink/10 hover:ring-amber/60 hover:shadow-md transition-all cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: isImage ? '1' : 'auto', minHeight: isPDF ? 64 : undefined }}
      >
        {/* Image */}
        {isImage && imgUrl && (
          <img
            src={imgUrl}
            alt=""
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
          />
        )}
        {isImage && !imgUrl && (
          <div className="w-full h-full flex items-center justify-center text-ink/30 text-[10px]">No image</div>
        )}

        {/* Link */}
        {link && (
          <div className="w-full p-2.5 flex items-start gap-1.5 text-[10.5px] text-ink leading-snug min-h-[58px]">
            <LinkIcon size={11} />
            <span className="line-clamp-3 break-all">{linkText}</span>
          </div>
        )}

        {/* Board */}
        {isBoard && (
          <div className="w-full p-2.5 flex items-start gap-2 min-h-[58px]">
            <span className="mt-0.5 shrink-0 text-amber">
              <BoardIcon size={13} />
            </span>
            <div>
              <div className="text-[11px] font-bold text-ink leading-tight line-clamp-2">
                {boardData?.name || 'Board'}
              </div>
              {boardItemCount !== null && (
                <div className="text-[9.5px] text-ink/45 mt-0.5">
                  {boardItemCount} item{boardItemCount === 1 ? '' : 's'} saved
                </div>
              )}
              {boardItemCount === null && (
                <div className="text-[9.5px] text-ink/35 mt-0.5">empty board</div>
              )}
            </div>
          </div>
        )}

        {/* PDF */}
        {isPDF && (
          <div className="w-full p-2.5 flex items-start gap-2 min-h-[58px]">
            <span className="mt-0.5 shrink-0">
              <StoragePDFIcon />
            </span>
            <div>
              <div className="text-[11px] font-bold text-ink leading-tight line-clamp-2">
                {pdfData?.name || 'document.pdf'}
              </div>
              {pdfData?.size && (
                <div className="text-[9.5px] text-ink/45 mt-0.5">
                  {pdfData.size < 1048576
                    ? `${(pdfData.size / 1024).toFixed(0)} KB`
                    : `${(pdfData.size / 1048576).toFixed(1)} MB`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Type badge */}
        {isBoard && (
          <div className="absolute top-1.5 right-6 text-[8px] font-bold uppercase tracking-wide text-amber/70 bg-amber/10 px-1 py-0.5 rounded">
            Board
          </div>
        )}
        {isPDF && (
          <div className="absolute top-1.5 right-6 text-[8px] font-bold uppercase tracking-wide text-red-700/70 bg-red-50 px-1 py-0.5 rounded">
            PDF
          </div>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-ink/80 text-paper opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
          title="Delete"
        >
          <TrashIcon size={10} />
        </button>
      </div>

      {ctxMenu && (
        <StorageCardMenu
          item={item}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onDelete={onDelete}
        />
      )}
    </>
  );
}

// ── Tiny icon helpers ──────────────────────────────────────────────────────
function DownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function StoragePDFIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
