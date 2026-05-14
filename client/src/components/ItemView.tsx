import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BaseItem, StickyData, ImageData, LinkData, BoardRefData, DocumentData, Stroke } from '../types';
import { api } from '../api';
import { GripIcon, TrashIcon, BoardIcon, CameraIcon, LinkIcon, ImageIcon, DocumentIcon } from './icons';

interface Props {
  item: BaseItem;
  selected: boolean;
  selectionIds: string[];
  scale: number;
  interactive: boolean;
  strokes: Stroke[];
  view: { x: number; y: number; scale: number };
  isMergeTarget?: boolean;
  onSelect: (additive: boolean) => void;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onMoveGroup: (ids: string[], dx: number, dy: number) => void;
  onDelete: () => void;
  onEnterBoard: () => void;
  onMoveLayer?: (id: string, dir: 'forward' | 'backward') => void;
  onSendToStorage?: (id: string) => void;
  onSetMergeTarget?: (id: string | null) => void;
  onMerge?: (srcId: string, targetId: string) => void;
  onOpenDocument?: (id: string) => void;
  /** Smoothly zooms/pans the camera so this item fills ~70% of the viewport. */
  onFocus?: () => void;
}

function youTubeId(raw: string): string | null {
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/]+)/);
      if (m) return m[2];
    }
  } catch { /* ignore */ }
  return null;
}

export default function ItemView({
  item, selected, selectionIds, scale, interactive, strokes, view,
  isMergeTarget,
  onSelect, onUpdate, onMoveGroup, onDelete, onEnterBoard, onMoveLayer,
  onSendToStorage, onSetMergeTarget, onMerge, onOpenDocument, onFocus,
}: Props) {
  const mergeTargetIdRef = useRef<string | null>(null);
  // Drag-tracking. `wasSelected` records whether the item was already
  // selected at press time, which lets endDrag distinguish "this press
  // just selected the item" from "this press is a click-to-activate".
  type Corner = 'tl' | 'tr' | 'bl' | 'br';
  const dragRef = useRef<{
    px: number; py: number;
    ix: number; iy: number;
    iw: number; ih: number;
    ifx: number; ify: number; ifw: number; ifh: number;
    mode: 'move' | 'resize';
    corner: Corner;
    hasFrame: boolean;
    moved: boolean;
    wasSelected: boolean;
  } | null>(null);
  const [ghost, setGhost] = useState<{
    x: number; y: number; w: number; h: number;
    frame?: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const lastDelta = useRef<{ dx: number; dy: number } | null>(null);

  // Per-item editing state. Only meaningful for sticky/text/link, but lives
  // here so we can flip it on a second click without round-tripping through
  // the parent. Resets whenever the item is deselected.
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);

  // Right-click context menu (currently only used for image items).
  // Coordinates are in viewport space — the menu is portalled at fixed pos.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  function canDragFrom(target: EventTarget | null) {
    return !(target as HTMLElement | null)?.closest(
      'button, input, textarea, a, iframe, [data-no-item-drag]'
    );
  }

  // Walk the stack of elements at the cursor and return the topmost
  // sticky/link item that isn't the one being dragged.
  function findMergeTargetAt(clientX: number, clientY: number, excludeId: string): string | null {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const itemEl = (el as HTMLElement).closest('[data-item-id]') as HTMLElement | null;
      if (!itemEl) continue;
      const id = itemEl.getAttribute('data-item-id');
      if (!id || id === excludeId) continue;
      const t = itemEl.getAttribute('data-item-type');
      if (t === 'sticky' || t === 'link') return id;
    }
    return null;
  }

  function startDrag(e: React.PointerEvent, mode: 'move' | 'resize', corner: Corner = 'br') {
    if (!interactive) return;
    e.stopPropagation();
    const wasSelected = selected;

    // If the item isn't selected yet, just select it — don't start a drag.
    // The user can then press a second time (while selected) to drag.
    if (!wasSelected && mode === 'move') {
      onSelect(e.shiftKey);
      return;
    }

    if (!wasSelected || mode === 'resize') onSelect(e.shiftKey);
    const dataAny = item.data as { imgFrame?: { x: number; y: number; w: number; h: number } };
    const fr = dataAny.imgFrame;
    dragRef.current = {
      px: e.clientX, py: e.clientY,
      ix: item.x, iy: item.y,
      iw: item.w, ih: item.h,
      ifx: fr?.x ?? 0, ify: fr?.y ?? 0,
      ifw: fr?.w ?? item.w, ifh: fr?.h ?? item.h,
      mode,
      corner,
      hasFrame: !!fr,
      moved: false,
      wasSelected,
    };
    lastDelta.current = { dx: 0, dy: 0 };
    setGhost({
      x: item.x, y: item.y, w: item.w, h: item.h,
      frame: fr ? { x: fr.x, y: fr.y, w: fr.w, h: fr.h } : undefined,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / scale;
    const dy = (e.clientY - d.py) / scale;
    if (Math.hypot(e.clientX - d.px, e.clientY - d.py) > 3) d.moved = true;
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
      // Hover-merge: while dragging a sticky or text on top of another
      // sticky/text, mark it as the merge target so it can pulse and
      // glow. Single-item drags only — group moves never merge.
      if (onSetMergeTarget && d.moved && selectionIds.length <= 1 &&
          (item.type === 'sticky' || item.type === 'link')) {
        const target = findMergeTargetAt(e.clientX, e.clientY, item.id);
        if (target !== mergeTargetIdRef.current) {
          mergeTargetIdRef.current = target;
          onSetMergeTarget(target);
        }
      }
      return;
    }

    // Resize. Corner-aware so TL/TR/BL grow the box outward in the
    // requested direction. For image items in extend mode we also keep
    // the inner image visually anchored by compensating imgFrame.x/y.
    const corner = d.corner;
    let nx = d.ix, ny = d.iy, nw = d.iw, nh = d.ih;
    let nfx = d.ifx, nfy = d.ify;

    if (corner === 'br' || corner === 'tr') nw = d.iw + dx;
    if (corner === 'br' || corner === 'bl') nh = d.ih + dy;

    if (corner === 'bl' || corner === 'tl') {
      // Pull from the left. Clamp so the inner image stays inside the
      // box and the box doesn't shrink below the image's right edge.
      const minWidth = d.hasFrame ? Math.max(60, d.ifx + d.ifw) : 60;
      let cdx = Math.min(dx, d.ifx);            // image-frame left ≥ 0
      cdx = Math.min(cdx, d.iw - minWidth);     // resulting width ≥ minWidth
      nx = d.ix + cdx;
      nw = d.iw - cdx;
      nfx = d.ifx - cdx;
    }
    if (corner === 'tr' || corner === 'tl') {
      const minHeight = d.hasFrame ? Math.max(40, d.ify + d.ifh) : 40;
      let cdy = Math.min(dy, d.ify);
      cdy = Math.min(cdy, d.ih - minHeight);
      ny = d.iy + cdy;
      nh = d.ih - cdy;
      nfy = d.ify - cdy;
    }

    nw = Math.max(60, nw);
    nh = Math.max(40, nh);

    setGhost({
      x: nx, y: ny, w: nw, h: nh,
      frame: d.hasFrame ? { x: nfx, y: nfy, w: d.ifw, h: d.ifh } : undefined,
    });
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const finalBox = ghost ?? { x: d.ix, y: d.iy, w: d.iw, h: d.ih };

    // Drop-on-storage: if the pointer is released over the Storage drawer,
    // send the item there instead of committing the move.
    let droppedToStorage = false;
    if (d.mode === 'move' && d.moved && onSendToStorage &&
        (item.type === 'image' || item.type === 'link')) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (el?.closest('[data-storage-drop="true"]')) {
        onSendToStorage(item.id);
        droppedToStorage = true;
      }
    }

    // Drop-to-merge: a sticky/text dropped on top of another sticky/text
    // is consumed and its text appended to the target.
    let mergedAway = false;
    const pendingMergeTarget = mergeTargetIdRef.current;
    if (!droppedToStorage && d.mode === 'move' && d.moved && pendingMergeTarget &&
        onMerge && (item.type === 'sticky' || item.type === 'link')) {
      onMerge(item.id, pendingMergeTarget);
      mergedAway = true;
    }
    mergeTargetIdRef.current = null;
    onSetMergeTarget?.(null);

    if (!droppedToStorage && !mergedAway) {
      if (d.mode === 'move') {
        onUpdate({ x: finalBox.x, y: finalBox.y });
      } else {
        const patch: Partial<BaseItem> = {
          x: finalBox.x, y: finalBox.y, w: finalBox.w, h: finalBox.h,
        };
        // Persist scaled imgFrame for image items in extend mode.
        if (d.hasFrame && finalBox.frame) {
          patch.data = { ...item.data, imgFrame: finalBox.frame };
        }
        // Scale text size for sticky/link so resizing the box also
        // resizes its text (area-proportional, sqrt of area ratio).
        if ((item.type === 'sticky' || item.type === 'link') &&
            d.iw > 0 && d.ih > 0) {
          const ratio = Math.sqrt((finalBox.w * finalBox.h) / (d.iw * d.ih));
          if (Math.abs(ratio - 1) > 0.001) {
            const dataAny = item.data as { fontSize?: number };
            const defaultFS = item.type === 'sticky' ? 12.5 : 16;
            const oldFS = dataAny.fontSize ?? defaultFS;
            const nextFS = Math.max(6, Math.min(160, oldFS * ratio));
            patch.data = { ...item.data, fontSize: nextFS };
          }
        }
        onUpdate(patch);
      }
    }
    dragRef.current = null;
    lastDelta.current = null;
    setGhost(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (droppedToStorage || mergedAway) return;

    // Click-to-activate. Only fires when:
    //   - this was a press, not a drag (no movement),
    //   - this was the second press (item was already selected at press time),
    //   - we're in move mode (resize handle clicks shouldn't activate edit).
    if (d.mode === 'move' && !d.moved && d.wasSelected) {
      if (item.type === 'board') {
        onEnterBoard();
      } else if (item.type === 'sticky' || item.type === 'link') {
        setEditing(true);
      } else if (item.type === 'document' && onOpenDocument) {
        onOpenDocument(item.id);
      }
    }
  }

  const pos = ghost ?? item;
  const controlScale = 1 / scale;
  const fixedControl = (x: string, y: string): React.CSSProperties => ({
    left: x,
    top: y,
    transform: `scale(${controlScale}) translate(-50%, -50%)`,
    transformOrigin: 'top left',
    zIndex: 60,
  });

  // Live preview of the inner image frame while extending. When the
  // ghost has a frame it overrides the persisted data.imgFrame so users
  // see white-space grow on the corner they are dragging.
  const liveFrame = ghost?.frame;
  // Linear scale ratio for live-previewing text size during a resize
  // drag. Stored values only update on endDrag.
  const liveTextScale = (item.w > 0 && item.h > 0)
    ? Math.sqrt((pos.w * pos.h) / (item.w * item.h))
    : 1;

  const inImageExtend = item.type === 'image' &&
    !!(item.data as { imgFrame?: unknown }).imgFrame;

  return (
    <div
      data-item
      data-item-id={item.id}
      data-item-type={item.type}
      className={`group absolute${
        isMergeTarget ? ' animate-mergeGlow' : selected ? ' animate-itemWiggle' : ''
      }`}
      style={{
        left: pos.x, top: pos.y, width: pos.w, height: pos.h,
        pointerEvents: interactive ? 'auto' : 'none',
        zIndex: isMergeTarget ? 99999 : selected ? 100000 + (item.z ?? 0) : item.z ?? 0,
        filter: !isMergeTarget && selected
          ? 'drop-shadow(0 8px 16px rgba(26,21,16,0.22)) drop-shadow(0 2px 5px rgba(26,21,16,0.14))'
          : undefined,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (!canDragFrom(e.target)) return;
        startDrag(e, 'move');
      }}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => {
        if (item.type !== 'image') return;
        const url = (item.data as Partial<ImageData>).url;
        if (!url) return;
        e.preventDefault();
        e.stopPropagation();
        if (!selected) onSelect(false);
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {item.type === 'sticky' && (
        <Sticky item={item} selected={selected} editing={editing} liveTextScale={liveTextScale} onDoneEditing={() => setEditing(false)} onUpdate={onUpdate} />
      )}
      {item.type === 'image' && (
        <ImageBox item={item} selected={selected} strokes={strokes} view={view} liveFrame={liveFrame} onUpdate={onUpdate} />
      )}
      {item.type === 'link' && (
        <TextOrLink item={item} selected={selected} editing={editing} liveTextScale={liveTextScale} onDoneEditing={() => setEditing(false)} onUpdate={onUpdate} />
      )}
      {item.type === 'board' && <BoardRefBox item={item} selected={selected} onUpdate={onUpdate} onEnterBoard={onEnterBoard} />}
      {item.type === 'document' && (
        <DocumentBox item={item} selected={selected} onOpen={() => onOpenDocument?.(item.id)} />
      )}

      {/* Drag grip — fixed screen size even while the canvas is zoomed.
          Hidden in image-extend mode where the TL corner is a resize handle. */}
      {!inImageExtend && (
        <button
          title="Drag"
          className={`absolute w-7 h-7 rounded-full bg-white shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/60 hover:text-ink cursor-grab active:cursor-grabbing transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={fixedControl('0%', '0%')}
          onPointerDown={(e) => startDrag(e, 'move')}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripIcon size={14} />
        </button>
      )}

      {selected && !inImageExtend && (
        <div
          className="absolute flex items-center gap-1"
          style={fixedControl('100%', '0%')}
        >
          <TextFormatButtons item={item} onUpdate={onUpdate} />
          {item.type === 'image' && onMoveLayer && (
            <>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onMoveLayer(item.id, 'forward'); }}
                title="Bring forward"
                className="w-[26px] h-[26px] rounded-full bg-white text-ink shadow ring-1 ring-ink/10 flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 15 6-6 6 6"/>
                </svg>
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onMoveLayer(item.id, 'backward'); }}
                title="Send backward"
                className="w-[26px] h-[26px] rounded-full bg-white text-ink shadow ring-1 ring-ink/10 flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
            </>
          )}
          {item.type === 'image' && (item.data as Partial<ImageData>).url && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const url = (item.data as Partial<ImageData>).url;
                if (url) void downloadImage(url);
              }}
              title="Download image"
              className="w-[26px] h-[26px] rounded-full bg-white text-ink shadow ring-1 ring-ink/10 flex items-center justify-center"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
          {(item.type === 'image' || item.type === 'link') && onSendToStorage && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onSendToStorage(item.id); }}
              title="Send to storage"
              className="w-[26px] h-[26px] rounded-full bg-white text-ink shadow ring-1 ring-ink/10 flex items-center justify-center"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
                <path d="M3 8l9 5 9-5" />
                <path d="M12 13v8" />
              </svg>
            </button>
          )}
          {onFocus && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onFocus(); }}
              title="Focus (F)"
              className="w-[26px] h-[26px] rounded-full bg-white text-ink shadow ring-1 ring-ink/10 flex items-center justify-center"
            >
              {/* Crosshair / fit-to-view glyph */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 3v3" />
                <path d="M12 18v3" />
                <path d="M3 12h3" />
                <path d="M18 12h3" />
              </svg>
            </button>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-[26px] h-[26px] rounded-full bg-ink text-paper shadow flex items-center justify-center"
            title="Delete"
          ><TrashIcon size={14} /></button>
        </div>
      )}

      <ResizeHandle
        corner="br"
        selected={selected}
        style={fixedControl('100%', '100%')}
        onStart={(e) => startDrag(e, 'resize', 'br')}
        onMove={onDrag}
        onEnd={endDrag}
      />

      {/* Extra corner handles when an image is in AI extend mode, so the
          user can grow white space toward any corner instead of just BR. */}
      {inImageExtend && (
        <>
          <ResizeHandle
            corner="tl"
            selected={selected}
            style={fixedControl('0%', '0%')}
            onStart={(e) => startDrag(e, 'resize', 'tl')}
            onMove={onDrag}
            onEnd={endDrag}
          />
          <ResizeHandle
            corner="tr"
            selected={selected}
            style={fixedControl('100%', '0%')}
            onStart={(e) => startDrag(e, 'resize', 'tr')}
            onMove={onDrag}
            onEnd={endDrag}
          />
          <ResizeHandle
            corner="bl"
            selected={selected}
            style={fixedControl('0%', '100%')}
            onStart={(e) => startDrag(e, 'resize', 'bl')}
            onMove={onDrag}
            onEnd={endDrag}
          />
        </>
      )}

      {ctxMenu && item.type === 'image' && (
        <ImageContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          url={(item.data as Partial<ImageData>).url ?? ''}
          canSendToStorage={!!onSendToStorage}
          onClose={() => setCtxMenu(null)}
          onSendToStorage={onSendToStorage ? () => onSendToStorage(item.id) : undefined}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

async function downloadImage(url: string) {
  // Pick a reasonable filename from the URL path, falling back to a default.
  let filename = 'image';
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && /\./.test(last)) filename = last;
  } catch { /* keep default */ }

  // For data: URLs and same-origin / CORS-permissive sources, fetch into a
  // blob so the browser saves the bytes directly. If that fails (CORS, opaque
  // response, etc.) fall back to a plain anchor — the user may still get a
  // download depending on the response's Content-Disposition.
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      const ext = (blob.type.split('/')[1] || 'png').split(';')[0];
      filename = `${filename}.${ext}`;
    }
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    if (!('ClipboardItem' in window) || !navigator.clipboard?.write) return false;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return false;
    let blob = await res.blob();
    // The Clipboard API only accepts image/png on most browsers — convert
    // anything else (jpeg, webp, gif…) through a canvas.
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      });
    }
    // eslint-disable-next-line no-undef
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function ImageContextMenu({
  x, y, url, canSendToStorage, onClose, onSendToStorage, onDelete,
}: {
  x: number; y: number; url: string;
  canSendToStorage: boolean;
  onClose: () => void;
  onSendToStorage?: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Nudge the menu inside the viewport after first render so it never gets
  // clipped at the right/bottom edge.
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

  function run(action: () => void | Promise<void>) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
      void action();
    };
  }

  const items: Array<{ label: string; icon: ReactNode; action: () => void | Promise<void>; danger?: boolean; disabled?: boolean }> = [
    {
      label: 'Download image',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      ),
      action: () => downloadImage(url),
    },
    {
      label: 'Copy image',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M7 21h12a2 2 0 0 0 2-2V9" />
        </svg>
      ),
      action: async () => {
        const ok = await copyImageToClipboard(url);
        if (!ok) {
          const fallback = await copyToClipboard(url);
          if (!fallback) alert('Could not copy image.');
        }
      },
    },
    {
      label: 'Copy image URL',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
        </svg>
      ),
      action: async () => {
        const ok = await copyToClipboard(url);
        if (!ok) alert('Could not copy URL.');
      },
      disabled: url.startsWith('data:'),
    },
    {
      label: 'Open in new tab',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
      action: () => { window.open(url, '_blank', 'noopener,noreferrer'); },
    },
    ...(canSendToStorage && onSendToStorage ? [{
      label: 'Send to storage',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
          <path d="M3 8l9 5 9-5" />
          <path d="M12 13v8" />
        </svg>
      ),
      action: onSendToStorage,
    }] : []),
    {
      label: 'Delete',
      icon: <TrashIcon size={14} />,
      action: onDelete,
      danger: true,
    },
  ];

  // Portalled to body so the zoomed/transformed canvas ancestor doesn't
  // capture our `position: fixed`.
  return createPortal(
    <div
      ref={ref}
      data-no-item-drag
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[100000] min-w-[180px] py-1 rounded-xl text-[12px] text-ink"
      style={{
        left: pos.x,
        top: pos.y,
        background: 'rgba(253,250,245,0.98)',
        border: '1px solid rgba(26,21,16,0.10)',
        boxShadow: '0 10px 28px rgba(26,21,16,0.18), 0 2px 6px rgba(26,21,16,0.10)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onClick={run(it.action)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-ink/[0.06] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          style={it.danger ? { color: '#C0392B' } : undefined}
        >
          <span className="w-4 h-4 flex items-center justify-center shrink-0">{it.icon}</span>
          <span className="flex-1">{it.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

function ResizeHandle({
  corner, selected, style, onStart, onMove, onEnd,
}: {
  corner: 'tl' | 'tr' | 'bl' | 'br';
  selected: boolean;
  style: React.CSSProperties;
  onStart: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onEnd: (e: React.PointerEvent) => void;
}) {
  const cursor = corner === 'br' || corner === 'tl' ? 'nwse-resize' : 'nesw-resize';
  // Diagonal arrow tick direction differs per corner so the icon points
  // outward toward the corner being grown.
  const path =
    corner === 'br' ? 'M9 21 21 9 M14 21 21 14 M19 21 21 19' :
    corner === 'tl' ? 'M3 15 15 3 M3 10 10 3 M3 5 5 3' :
    corner === 'tr' ? 'M9 3 21 15 M14 3 21 10 M19 3 21 5' :
                      'M3 9 15 21 M3 14 10 21 M3 19 5 21';
  return (
    <div
      className={`absolute w-6 h-6 rounded-full bg-white shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/60 transition-opacity ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
      style={{ ...style, cursor }}
      onPointerDown={onStart}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      title="Resize"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d={path} />
      </svg>
    </div>
  );
}

function Sticky({
  item, selected, editing, liveTextScale, onDoneEditing, onUpdate,
}: {
  item: BaseItem; selected: boolean; editing: boolean;
  liveTextScale: number;
  onDoneEditing: () => void; onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<StickyData>;
  const boxShadow = selected
    ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)'
    : '0 2px 10px rgba(26,21,16,0.09)';
  const baseFS = d.fontSize ?? 12.5;
  const fontSize = baseFS * liveTextScale;
  const hwClass = d.font === 'handwriting' ? ' font-handwriting' : '';
  // Stickies default to regular weight; B-toggle bumps to 700.
  const fontWeight = d.bold ? 700 : 400;

  if (editing) {
    return (
      <textarea
        autoFocus
        className={`w-full h-full resize-none border-0 outline-none p-[13px_15px] leading-[1.7] text-ink whitespace-pre-wrap${hwClass}`}
        placeholder="Type something…"
        value={d.text ?? ''}
        onChange={(e) => onUpdate({ data: { ...d, text: e.target.value } })}
        onBlur={onDoneEditing}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLTextAreaElement).blur(); }}
        style={{
          background: d.color || '#FFF3C4',
          borderRadius: 16,
          boxShadow,
          fontSize,
          fontWeight,
        }}
      />
    );
  }

  return (
    <div
      className={`w-full h-full p-[13px_15px] leading-[1.7] text-ink whitespace-pre-wrap overflow-hidden cursor-text${hwClass}`}
      style={{
        background: d.color || '#FFF3C4',
        borderRadius: 16,
        boxShadow,
        fontSize,
        fontWeight,
      }}
    >
      {d.text || <span className="text-ink/45 italic">Click to select, click again to type…</span>}
    </div>
  );
}

type ImgFrame = { x: number; y: number; w: number; h: number };

function ImageBox({
  item, selected, strokes, view, liveFrame, onUpdate,
}: {
  item: BaseItem; selected: boolean;
  strokes: Stroke[]; view: { x: number; y: number; scale: number };
  liveFrame?: ImgFrame;
  onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<ImageData> & {
    versions?: string[];
    imgFrame?: ImgFrame;
  };
  const versions: string[] = d.versions ?? (d.url ? [d.url] : []);
  const currentUrl = d.url ?? null;
  const currentIdx = currentUrl ? Math.max(0, versions.lastIndexOf(currentUrl)) : 0;
  const inExtendMode = !!d.imgFrame;
  // Live preview frame wins over the persisted one while the user is
  // dragging a corner so white space appears on the right side.
  const frame: ImgFrame = liveFrame ?? d.imgFrame ?? { x: 0, y: 0, w: item.w, h: item.h };

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiRefs, setAiRefs] = useState<string[]>([]);
  const [aiRefLoading, setAiRefLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVariants, setAiVariants] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selected) { setAiOpen(false); setAiPrompt(''); setAiRefs([]); setAiVariants([]); }
  }, [selected]);

  // Extend mode is tied to the AI panel:
  //   - Opening the panel locks the image's current pixel box into
  //     data.imgFrame so resizing grows white margins around it.
  //   - Closing the panel (without a successful regenerate) drops the
  //     extend canvas back to a plain image — resizing is normal again.
  //   - A successful regenerate clears imgFrame from inside runAIEdit.
  useEffect(() => {
    if (aiOpen && currentUrl && !d.imgFrame) {
      onUpdate({ data: { ...d, imgFrame: { x: 0, y: 0, w: item.w, h: item.h } } });
    } else if (!aiOpen && d.imgFrame) {
      // Snap the bounding box back to the image so the user isn't left
      // with a stretched image filling the white space they were
      // experimenting with. Shift x/y by the frame offset so the image
      // stays put on screen even after a TL/TR/BL extend.
      const f = d.imgFrame;
      const next = { ...d } as Record<string, unknown>;
      delete next.imgFrame;
      onUpdate({ x: item.x + f.x, y: item.y + f.y, w: f.w, h: f.h, data: next });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen]);

  function exitExtendMode() {
    if (!d.imgFrame) return;
    const f = d.imgFrame;
    const next = { ...d };
    delete next.imgFrame;
    onUpdate({ x: item.x + f.x, y: item.y + f.y, w: f.w, h: f.h, data: next });
  }

  useEffect(() => {
    if (aiLoading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [aiLoading]);

  function commitAIResult(url: string) {
    const newVersions = [...versions, url];
    const nextData = { ...d, url, versions: newVersions };
    delete (nextData as Record<string, unknown>).imgFrame;
    onUpdate({ data: nextData });
    setAiOpen(false);
    setAiPrompt('');
    setAiRefs([]);
    setAiVariants([]);
  }

  async function runAIEdit(variantCount = 1) {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      // 1. Render the (possibly extended) image + overlapping strokes onto a
      //    square PNG. White areas around the image are sent to the model so
      //    it can outpaint into them.
      const dataUrl = await captureItemWithStrokes(item, strokes, view);
      // 2. Send to server → OpenAI, with any attached reference photos and
      //    requested variant count.
      const result = await api.aiImageEdit(
        dataUrl,
        aiPrompt.trim(),
        aiRefs.length > 0 ? aiRefs : undefined,
        variantCount,
      );
      // 3a. Single result: commit straight away. 3b. Multi: open picker
      //     and hide the prompt panel so the variants get the whole image.
      if (variantCount <= 1 || result.urls.length <= 1) {
        commitAIResult(result.urls[0] ?? result.url);
      } else {
        setAiVariants(result.urls);
        setAiOpen(false);
      }
    } catch (e) {
      alert(`AI edit failed: ${(e as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  }

  async function addRefFiles(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    setAiRefLoading(true);
    try {
      const dataUrls = await Promise.all(imgs.map((f) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(f);
      })));
      setAiRefs((prev) => [...prev, ...dataUrls].slice(0, 8));
    } finally {
      setAiRefLoading(false);
    }
  }

  function switchVersion(idx: number) {
    const url = versions[idx];
    if (!url) return;
    onUpdate({ data: { ...d, url, versions } });
  }

  function deleteVersion(idx: number) {
    if (versions.length <= 1) return;
    const removedUrl = versions[idx];
    const newVersions = versions.filter((_, i) => i !== idx);
    // If the user deletes the version they're currently viewing, fall
    // back to the neighbour at the same slot (or the new last one).
    let nextUrl = currentUrl;
    if (removedUrl === currentUrl) {
      nextUrl = newVersions[Math.min(idx, newVersions.length - 1)] ?? newVersions[0];
    }
    onUpdate({ data: { ...d, url: nextUrl, versions: newVersions } });
  }

  if (!currentUrl) {
    return (
      <div
        className="w-full h-full rounded-2xl flex flex-col items-center justify-center gap-2 text-ink/50"
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
    <div className="w-full h-full relative">
      {inExtendMode ? (
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden"
          style={{
            background: '#ffffff',
            boxShadow: selected ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)' : '0 2px 10px rgba(26,21,16,0.09)',
            outline: '2px dashed rgba(217,116,53,0.55)',
            outlineOffset: -2,
          }}
        >
          <img
            src={currentUrl}
            alt=""
            draggable={false}
            className="absolute pointer-events-none"
            style={{
              left: frame.x,
              top: frame.y,
              width: frame.w,
              height: frame.h,
              objectFit: 'cover',
            }}
          />
          {/* Extend-mode badge + exit */}
          <div
            data-no-item-drag
            className="absolute top-2 left-2 flex items-center gap-1 px-2 py-[3px] rounded-full text-[9px] font-bold uppercase tracking-[0.05em] z-20"
            style={{
              background: 'rgba(217,116,53,0.95)',
              color: 'white',
              boxShadow: '0 2px 8px rgba(26,21,16,0.18)',
            }}
          >
            <span>Extend</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); exitExtendMode(); }}
              title="Exit extend mode (keep image at current size)"
              className="ml-0.5 w-3.5 h-3.5 rounded-full bg-white/30 hover:bg-white/55 flex items-center justify-center text-white text-[9px] leading-none"
            >×</button>
          </div>
        </div>
      ) : (
        <img
          src={currentUrl}
          alt=""
          draggable={false}
          className="w-full h-full object-cover rounded-2xl pointer-events-none"
          style={{ boxShadow: selected ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)' : '0 2px 10px rgba(26,21,16,0.09)' }}
        />
      )}

      {/* AI edit button — bottom-left, visible when selected */}
      {selected && !aiLoading && (
        <button
          data-no-item-drag
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setAiOpen((o) => !o); }}
          title="Edit with AI"
          className="absolute bottom-2 left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-all z-20"
          style={{
            background: aiOpen ? '#D97435' : 'rgba(253,250,245,0.95)',
            color: aiOpen ? 'white' : '#D97435',
            border: '1.5px solid rgba(217,116,53,0.35)',
          }}
        >
          <AIBrushIcon />
        </button>
      )}

      {/* Timer badge while generating */}
      {aiLoading && (
        <div
          className="absolute bottom-2 left-2 px-2 py-1 rounded-full text-[10px] font-bold text-white flex items-center gap-1 z-20"
          style={{ background: '#D97435' }}
        >
          <span className="animate-pulse">✦</span>
          <span>{elapsed}s</span>
        </div>
      )}

      {/* AI prompt panel */}
      {aiOpen && selected && !aiLoading && (
        <div
          data-no-item-drag
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-10 left-0 right-0 mx-2 rounded-xl p-2 flex flex-col gap-2 z-30"
          style={{
            background: 'rgba(253,250,245,0.97)',
            boxShadow: '0 4px 18px rgba(26,21,16,0.15)',
            border: aiRefs.length > 0 ? '1.5px solid rgba(217,116,53,0.45)' : '1px solid rgba(26,21,16,0.08)',
            minWidth: 220,
          }}
        >
          {(aiRefs.length > 0 || aiRefLoading) && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.07em] text-[#D97435]">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>
                  {aiRefLoading ? 'Reading…' : `${aiRefs.length} reference${aiRefs.length === 1 ? '' : 's'} attached`}
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {aiRefs.map((u, i) => (
                  <div
                    key={i}
                    className="relative rounded-md overflow-hidden ring-2 ring-[#D97435]/55 shadow-sm"
                    style={{ width: 52, height: 52 }}
                  >
                    <img src={u} alt="" className="w-full h-full object-cover pointer-events-none" />
                    <button
                      onClick={() => setAiRefs((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove reference"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ink text-white text-[10px] leading-none flex items-center justify-center shadow"
                    >×</button>
                  </div>
                ))}
                {aiRefLoading && (
                  <div
                    className="rounded-md ring-1 ring-ink/10 bg-ink/[0.04] flex items-center justify-center text-ink/45"
                    style={{ width: 52, height: 52 }}
                  >
                    <span className="animate-pulse text-[10px]">…</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-1.5 items-center">
            <button
              onClick={() => refInputRef.current?.click()}
              title="Attach reference image"
              className="relative w-7 h-7 rounded-md flex items-center justify-center transition-colors shrink-0"
              style={{
                background: aiRefs.length > 0 ? '#D97435' : 'transparent',
                color: aiRefs.length > 0 ? 'white' : 'rgba(26,21,16,0.55)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              {aiRefs.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-ink text-white text-[9px] font-bold leading-none flex items-center justify-center"
                >{aiRefs.length}</span>
              )}
            </button>
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = '';
                void addRefFiles(files);
              }}
            />
            <input
              autoFocus
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runAIEdit(); if (e.key === 'Escape') setAiOpen(false); }}
              placeholder={aiRefs.length > 0 ? 'Describe how to use the reference…' : 'Describe the edit…'}
              className="flex-1 min-w-0 text-[11px] bg-transparent outline-none text-ink placeholder:text-ink/35"
              style={{ fontFamily: 'inherit' }}
            />
            <button
              onClick={() => runAIEdit(1)}
              disabled={!aiPrompt.trim()}
              title="Generate one image"
              className="h-6 px-2.5 rounded-lg text-[10px] font-bold text-white transition-all disabled:opacity-40 shrink-0"
              style={{ background: '#D97435' }}
            >
              Go
            </button>
            <button
              onClick={() => runAIEdit(4)}
              disabled={!aiPrompt.trim()}
              title="Generate 4 variations to pick from"
              className="h-6 px-2 rounded-lg text-[10px] font-bold transition-all disabled:opacity-40 shrink-0 flex items-center gap-0.5"
              style={{
                background: 'rgba(217,116,53,0.12)',
                color: '#D97435',
                border: '1px solid rgba(217,116,53,0.45)',
              }}
            >
              <span className="text-[8px] opacity-70">×</span>4
            </button>
          </div>
        </div>
      )}

      {/* Variant picker — shown after a ×N generation. Click a thumb to
          commit it; the rest are discarded. */}
      {aiVariants.length > 0 && selected && !aiLoading && (
        <div
          data-no-item-drag
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-0 rounded-2xl z-40 flex flex-col items-stretch p-2 gap-1.5"
          style={{
            background: 'rgba(26,21,16,0.78)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.07em] text-white/90 px-1">
            <span>Pick a variant</span>
            <button
              onClick={() => setAiVariants([])}
              title="Discard all and start over"
              className="text-white/65 hover:text-white text-[14px] leading-none px-1"
            >×</button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 flex-1 min-h-0">
            {aiVariants.map((u, i) => (
              <button
                key={i}
                onClick={() => commitAIResult(u)}
                title={`Pick variant ${i + 1}`}
                className="relative rounded-lg overflow-hidden ring-1 ring-white/20 hover:ring-2 hover:ring-[#D97435] transition-all"
              >
                <img src={u} alt="" className="w-full h-full object-cover pointer-events-none" />
                <span className="absolute bottom-1 right-1 px-1.5 py-[1px] rounded bg-ink/70 text-white text-[9px] font-bold pointer-events-none">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Version badge + panel */}
      {selected && versions.length > 1 && (
        <VersionPanel
          versions={versions}
          currentIdx={currentIdx}
          onSwitch={switchVersion}
          onDelete={deleteVersion}
        />
      )}
    </div>
  );
}

// ── Version history panel ──────────────────────────────────────────────────
function VersionPanel({
  versions, currentIdx, onSwitch, onDelete,
}: {
  versions: string[];
  currentIdx: number;
  onSwitch: (idx: number) => void;
  onDelete: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the active thumbnail into view when panel opens
  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
      active?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open, currentIdx]);

  const label = currentIdx === 0 ? 'orig' : `v${currentIdx}`;

  return (
    <>
      {/* Badge button — sits at right edge of image, vertically centred */}
      <button
        data-no-item-drag
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Version history"
        className="absolute top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold transition-all z-20"
        style={{
          right: -36,
          background: open ? '#D97435' : 'rgba(253,250,245,0.95)',
          color: open ? 'white' : '#D97435',
          border: '1.5px solid rgba(217,116,53,0.35)',
          boxShadow: '0 2px 8px rgba(26,21,16,0.12)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M1 5l3-3 3 3' : 'M1 3l3 3 3-3'} />
        </svg>
      </button>

      {/* Vertical scroll panel — floats to the right of the image */}
      {open && (
        <div
          data-no-item-drag
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-0 bottom-0 rounded-2xl overflow-hidden z-30 flex flex-col"
          style={{
            right: -88,
            width: 72,
            background: 'rgba(253,250,245,0.97)',
            border: '1px solid rgba(26,21,16,0.09)',
            boxShadow: '0 8px 28px rgba(26,21,16,0.14)',
          }}
        >
          {/* Header */}
          <div className="px-2 pt-2 pb-1 text-[8px] font-bold uppercase tracking-widest text-ink/35 text-center shrink-0">
            Versions
          </div>

          {/* Scrollable thumbnail list */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto flex flex-col items-center gap-1.5 px-1.5 pb-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {versions.map((url, i) => (
              <div
                key={i}
                data-active={i === currentIdx ? 'true' : 'false'}
                className="group/v w-full shrink-0 rounded-lg overflow-hidden transition-all relative"
                style={{
                  aspectRatio: '1',
                  outline: i === currentIdx ? '2px solid #D97435' : '1.5px solid rgba(26,21,16,0.08)',
                  outlineOffset: i === currentIdx ? 1 : 0,
                  opacity: i === currentIdx ? 1 : 0.65,
                  transform: i === currentIdx ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onSwitch(i); }}
                  className="w-full h-full block"
                  title={i === 0 ? 'Original' : `AI edit ${i}`}
                >
                  <img
                    src={url}
                    alt={i === 0 ? 'Original' : `v${i}`}
                    draggable={false}
                    className="w-full h-full object-cover"
                  />
                </button>
                <span
                  className="absolute bottom-0.5 right-0.5 text-[7px] font-bold rounded px-0.5 leading-tight pointer-events-none"
                  style={{
                    background: i === currentIdx ? '#D97435' : 'rgba(26,21,16,0.45)',
                    color: 'white',
                  }}
                >
                  {i === 0 ? 'orig' : `v${i}`}
                </span>
                {versions.length > 1 && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onDelete(i); }}
                    title="Delete version"
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-ink/85 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/v:opacity-100 transition-opacity"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Canvas capture helper ──────────────────────────────────────────────────
// Renders the image item + any strokes that overlap it into a square PNG.
async function captureItemWithStrokes(
  item: BaseItem,
  strokes: Stroke[],
  _view: { x: number; y: number; scale: number },
): Promise<string> {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const d = item.data as Partial<ImageData> & { imgFrame?: { x: number; y: number; w: number; h: number } };
  const url = d.url;

  // Map the item's bounding box → the SIZE×SIZE square (letterbox if needed),
  // then draw the image at its imgFrame inside that mapping. In normal mode
  // (no imgFrame) the image fills the whole bounding box, matching the
  // previous behaviour.
  const itemAR = item.w / item.h;
  let boxX = 0, boxY = 0, boxW = SIZE, boxH = SIZE;
  if (itemAR > 1) { boxH = SIZE / itemAR; boxY = (SIZE - boxH) / 2; }
  else if (itemAR < 1) { boxW = SIZE * itemAR; boxX = (SIZE - boxW) / 2; }
  const sx = boxW / item.w;
  const sy = boxH / item.h;

  const frame = d.imgFrame ?? { x: 0, y: 0, w: item.w, h: item.h };

  if (url) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const dx = boxX + frame.x * sx;
        const dy = boxY + frame.y * sy;
        const dw = frame.w * sx;
        const dh = frame.h * sy;
        ctx.drawImage(img, dx, dy, dw, dh);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  // Draw strokes that overlap the item bounding box
  const overlapping = strokes.filter((s) => {
    for (let i = 0; i < s.points.length; i += 3) {
      const wx = s.points[i], wy = s.points[i + 1];
      if (wx >= item.x && wx <= item.x + item.w && wy >= item.y && wy <= item.y + item.h) return true;
    }
    return false;
  });

  if (overlapping.length > 0) {
    // Map world coords → the (boxX, boxY, boxW, boxH) sub-rect inside SIZE.
    ctx.save();
    ctx.translate(boxX - item.x * sx, boxY - item.y * sy);
    ctx.scale(sx, sy);
    for (const s of overlapping) {
      if (s.points.length < 3) continue;
      ctx.beginPath();
      ctx.strokeStyle = s.color || '#000000';
      ctx.lineWidth = (s.width || 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(s.points[0], s.points[1]);
      for (let i = 3; i < s.points.length; i += 3) {
        ctx.lineTo(s.points[i], s.points[i + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

function AIBrushIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.636 5.636l2.122 2.122M16.243 16.243l2.121 2.121M5.636 18.364l2.122-2.121M16.243 7.757l2.121-2.121" />
    </svg>
  );
}

function TextOrLink({
  item, selected, editing, liveTextScale, onDoneEditing, onUpdate,
}: {
  item: BaseItem; selected: boolean; editing: boolean;
  liveTextScale: number;
  onDoneEditing: () => void; onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<LinkData>;
  const txt = (d.title || d.url || '').toString();
  const isUrl = /^https?:\/\/\S+$/i.test(txt.trim());
  const ytId = isUrl ? youTubeId(txt.trim()) : null;
  const baseFS = d.fontSize ?? 16;
  const fontSize = baseFS * liveTextScale;
  // Handwriting font only makes sense for plain text — drop it for URLs.
  const isHandwriting = d.font === 'handwriting' && !isUrl;

  if (editing) {
    return (
      <textarea
        autoFocus
        className={`w-full h-full resize-none p-1.5 leading-snug bg-paper rounded-lg outline outline-2 outline-amber${isHandwriting ? ' font-handwriting' : ''}`}
        value={txt}
        placeholder="Type text or paste a link…"
        onChange={(e) => onUpdate({ data: { ...d, url: '', title: e.target.value } })}
        onBlur={onDoneEditing}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLTextAreaElement).blur(); }}
        style={{ fontSize }}
      />
    );
  }

  if (ytId) {
    return (
      <div
        className="w-full h-full rounded-2xl overflow-hidden"
        style={{
          boxShadow: selected ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)' : '0 2px 10px rgba(26,21,16,0.09)',
          background: '#000',
        }}
        data-no-item-drag
      >
        <iframe
          src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`}
          className="w-full h-full block"
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (isUrl) {
    return (
      <div
        className="w-full h-full flex items-center gap-2 px-3 rounded-lg cursor-text"
        style={{
          background: selected ? 'rgba(217,116,53,0.08)' : 'rgba(26,21,16,0.04)',
          border: `1px solid ${selected ? '#D97435' : 'rgba(26,21,16,0.10)'}`,
        }}
      >
        <LinkIcon size={13} />
        <span className="text-[12px] text-blue-600 underline overflow-hidden text-ellipsis whitespace-nowrap">{txt}</span>
      </div>
    );
  }

  // Text items legacy-default to bold (700) — preserve that when bold isn't
  // explicitly set. Handwriting font ignores the bold flag visually: its
  // weight already reads as "ink-on-paper" and 700 would crush the strokes.
  const isBold = d.bold !== false;
  const fontWeight = isHandwriting ? 400 : isBold ? 700 : 400;

  return (
    <div
      className={`w-full h-full text-ink whitespace-pre-wrap cursor-text rounded-lg p-1.5${isHandwriting ? ' font-handwriting' : ''}`}
      style={{
        fontSize,
        fontWeight,
        lineHeight: isHandwriting ? 1.2 : 1.45,
        letterSpacing: isHandwriting ? 'normal' : '-0.2px',
        boxShadow: selected ? '0 0 0 2px #D97435' : 'none',
      }}
    >
      {txt || <span className="text-ink/50 italic font-medium">Click to select, click again to type…</span>}
    </div>
  );
}

function BoardRefBox({
  item, selected, onUpdate, onEnterBoard,
}: { item: BaseItem; selected: boolean; onUpdate: (p: Partial<BaseItem>) => void; onEnterBoard: () => void }) {
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
          border: `2px solid ${highlight ? '#D97435' : hov ? 'rgba(26,21,16,0.32)' : 'rgba(26,21,16,0.22)'}`,
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

        {/* Enter-board arrow — always visible, gets orange bg when selected */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onEnterBoard(); }}
          title="Open board"
          className="absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-[13px] z-10 transition-all"
          style={{
            background: selected ? '#D97435' : 'transparent',
            color: selected ? '#fff' : 'rgba(26,21,16,0.45)',
            boxShadow: selected ? '0 2px 8px rgba(217,116,53,0.35)' : 'none',
            lineHeight: 1,
          }}
        >→</button>

        <div
          className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-[3px] rounded-md text-[9px] font-bold uppercase tracking-[0.05em] pointer-events-none"
          style={{
            background: 'rgba(253,250,245,0.92)',
            color: '#1A1510',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
          }}
        >
          <BoardIcon size={10} />
          <span>Board</span>
        </div>

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

function DocumentBox({
  item, selected, onOpen,
}: { item: BaseItem; selected: boolean; onOpen: () => void }) {
  const d = item.data as Partial<DocumentData>;
  const title = d.title || 'Untitled';
  return (
    <div
      className="w-full h-full rounded-2xl bg-white flex flex-col overflow-hidden"
      style={{
        boxShadow: selected
          ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)'
          : '0 2px 10px rgba(26,21,16,0.09)',
        border: '1px solid rgba(26,21,16,0.06)',
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 text-ink/55">
        <DocumentIcon size={12} />
        <span className="text-[9px] font-bold uppercase tracking-[0.07em]">Doc</span>
      </div>
      <div
        className="px-2.5 text-[12px] font-bold text-ink truncate"
        title={title}
      >{title}</div>
      <div
        className="flex-1 mt-1.5 mx-2 mb-2 rounded-md bg-ink/[0.03] px-2 py-1.5 text-[10px] leading-snug text-ink/65 overflow-hidden pointer-events-none"
        style={{ display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' }}
        // Sanitised content is produced inside DocumentEditor (mammoth /
        // controlled execCommand) so rendering it here is safe.
        dangerouslySetInnerHTML={{
          __html: d.content && d.content.trim()
            ? d.content
            : '<i style="color:rgba(26,21,16,0.35)">Empty — click to open</i>',
        }}
      />
      <button
        data-no-item-drag
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="mb-2 mx-2 h-7 rounded-md text-[10.5px] font-bold transition-colors"
        style={{
          background: '#D97435',
          color: '#fff',
        }}
      >Open</button>
    </div>
  );
}

// ── TextFormatButtons ────────────────────────────────────────────────
// A-, A+, B controls in the action cluster. Visible for stickies and for
// text-mode link items (links with no URL). Clicking patches data.fontSize /
// data.bold and the renderer picks it up. Font-size step is ±2 with a soft
// 8..96 clamp so users can't shrink past readability or blow up the layout.
function TextFormatButtons({
  item, onUpdate,
}: { item: BaseItem; onUpdate: (p: Partial<BaseItem>) => void }) {
  if (item.type !== 'sticky' && item.type !== 'link') return null;
  const d = item.data as Partial<StickyData & LinkData>;
  // Only show on link items that are actually text (no URL).
  if (item.type === 'link' && /^https?:\/\/\S+$/i.test((d.title || d.url || '').toString().trim())) {
    return null;
  }
  const defaultFS = item.type === 'sticky' ? 12.5 : 16;
  const fs = d.fontSize ?? defaultFS;
  // Bold semantics: sticky defaults to off, text-link defaults to on. The
  // explicit value `bold` overrides either way.
  const isBold = item.type === 'sticky' ? d.bold === true : d.bold !== false;

  function setFontSize(next: number) {
    const clamped = Math.max(8, Math.min(96, next));
    onUpdate({ data: { ...d, fontSize: clamped } as Record<string, unknown> });
  }
  function toggleBold() {
    onUpdate({ data: { ...d, bold: !isBold } as Record<string, unknown> });
  }

  const btnBase = 'w-[26px] h-[26px] rounded-full shadow ring-1 ring-ink/10 flex items-center justify-center text-[11px] font-bold';
  return (
    <>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setFontSize(fs - 2); }}
        title="Smaller text"
        className={`${btnBase} bg-white text-ink`}
      >A−</button>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setFontSize(fs + 2); }}
        title="Bigger text"
        className={`${btnBase} bg-white text-ink`}
      >A+</button>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggleBold(); }}
        title={isBold ? 'Remove bold' : 'Bold'}
        // Inverted colours when active so users can see the toggle state.
        className={`${btnBase} ${isBold ? 'bg-ink text-paper' : 'bg-white text-ink'}`}
        style={{ fontFamily: 'serif' }}
      >B</button>
    </>
  );
}
