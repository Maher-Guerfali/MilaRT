import { useEffect, useRef, useState } from 'react';
import type { BaseItem, StickyData, ImageData, LinkData, BoardRefData, Stroke } from '../types';
import { api } from '../api';
import { GripIcon, TrashIcon, BoardIcon, CameraIcon, LinkIcon, ImageIcon } from './icons';

interface Props {
  item: BaseItem;
  selected: boolean;
  selectionIds: string[];
  scale: number;
  interactive: boolean;
  strokes: Stroke[];
  view: { x: number; y: number; scale: number };
  onSelect: (additive: boolean) => void;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onMoveGroup: (ids: string[], dx: number, dy: number) => void;
  onDelete: () => void;
  onEnterBoard: () => void;
  onMoveLayer?: (id: string, dir: 'forward' | 'backward') => void;
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
  onSelect, onUpdate, onMoveGroup, onDelete, onEnterBoard, onMoveLayer,
}: Props) {
  // Drag-tracking. `wasSelected` records whether the item was already
  // selected at press time, which lets endDrag distinguish "this press
  // just selected the item" from "this press is a click-to-activate".
  const dragRef = useRef<{
    px: number; py: number;
    ix: number; iy: number;
    iw: number; ih: number;
    mode: 'move' | 'resize';
    moved: boolean;
    wasSelected: boolean;
  } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastDelta = useRef<{ dx: number; dy: number } | null>(null);

  // Per-item editing state. Only meaningful for sticky/text/link, but lives
  // here so we can flip it on a second click without round-tripping through
  // the parent. Resets whenever the item is deselected.
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);

  function canDragFrom(target: EventTarget | null) {
    return !(target as HTMLElement | null)?.closest(
      'button, input, textarea, a, iframe, [data-no-item-drag]'
    );
  }

  function startDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
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
    dragRef.current = {
      px: e.clientX, py: e.clientY,
      ix: item.x, iy: item.y,
      iw: item.w, ih: item.h,
      mode,
      moved: false,
      wasSelected,
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
    } else {
      setGhost({ x: d.ix, y: d.iy, w: Math.max(60, d.iw + dx), h: Math.max(40, d.ih + dy) });
    }
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const finalBox = ghost ?? { x: d.ix, y: d.iy, w: d.iw, h: d.ih };
    if (d.mode === 'move') onUpdate({ x: finalBox.x, y: finalBox.y });
    else onUpdate({ w: finalBox.w, h: finalBox.h });
    dragRef.current = null;
    lastDelta.current = null;
    setGhost(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    // Click-to-activate. Only fires when:
    //   - this was a press, not a drag (no movement),
    //   - this was the second press (item was already selected at press time),
    //   - we're in move mode (resize handle clicks shouldn't activate edit).
    if (d.mode === 'move' && !d.moved && d.wasSelected) {
      if (item.type === 'board') {
        onEnterBoard();
      } else if (item.type === 'sticky' || item.type === 'link') {
        setEditing(true);
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

  return (
    <div
      data-item
      data-item-id={item.id}
      className={`group absolute${selected ? ' animate-itemWiggle' : ''}`}
      style={{
        left: pos.x, top: pos.y, width: pos.w, height: pos.h,
        pointerEvents: interactive ? 'auto' : 'none',
        zIndex: selected ? 100000 + (item.z ?? 0) : item.z ?? 0,
        filter: selected ? 'drop-shadow(0 8px 16px rgba(26,21,16,0.22)) drop-shadow(0 2px 5px rgba(26,21,16,0.14))' : undefined,
      }}
      onPointerDown={(e) => {
        if (!canDragFrom(e.target)) return;
        startDrag(e, 'move');
      }}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {item.type === 'sticky' && (
        <Sticky item={item} selected={selected} editing={editing} onDoneEditing={() => setEditing(false)} onUpdate={onUpdate} />
      )}
      {item.type === 'image' && (
        <ImageBox item={item} selected={selected} strokes={strokes} view={view} onUpdate={onUpdate} />
      )}
      {item.type === 'link' && (
        <TextOrLink item={item} selected={selected} editing={editing} onDoneEditing={() => setEditing(false)} onUpdate={onUpdate} />
      )}
      {item.type === 'board' && <BoardRefBox item={item} selected={selected} onUpdate={onUpdate} onEnterBoard={onEnterBoard} />}

      {/* Drag grip — fixed screen size even while the canvas is zoomed. */}
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

      {selected && (
        <div
          className="absolute flex items-center gap-1"
          style={fixedControl('100%', '0%')}
        >
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
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-[26px] h-[26px] rounded-full bg-ink text-paper shadow flex items-center justify-center"
            title="Delete"
          ><TrashIcon size={14} /></button>
        </div>
      )}

      <div
        className={`absolute w-6 h-6 rounded-full bg-white shadow ring-1 ring-ink/10 flex items-center justify-center text-ink/60 cursor-se-resize transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={fixedControl('100%', '100%')}
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
  item, selected, editing, onDoneEditing, onUpdate,
}: {
  item: BaseItem; selected: boolean; editing: boolean;
  onDoneEditing: () => void; onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<StickyData>;
  const boxShadow = selected
    ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)'
    : '0 2px 10px rgba(26,21,16,0.09)';

  if (editing) {
    return (
      <textarea
        autoFocus
        className="w-full h-full resize-none border-0 outline-none p-[13px_15px] text-[12.5px] leading-[1.7] text-ink whitespace-pre-wrap"
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
        }}
      />
    );
  }

  return (
    <div
      className="w-full h-full p-[13px_15px] text-[12.5px] leading-[1.7] text-ink whitespace-pre-wrap overflow-hidden cursor-text"
      style={{
        background: d.color || '#FFF3C4',
        borderRadius: 16,
        boxShadow,
      }}
    >
      {d.text || <span className="text-ink/45 italic">Click to select, click again to type…</span>}
    </div>
  );
}

function ImageBox({
  item, selected, strokes, view, onUpdate,
}: {
  item: BaseItem; selected: boolean;
  strokes: Stroke[]; view: { x: number; y: number; scale: number };
  onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<ImageData> & { versions?: string[] };
  const versions: string[] = d.versions ?? (d.url ? [d.url] : []);
  const currentUrl = d.url ?? null;
  const currentIdx = currentUrl ? Math.max(0, versions.lastIndexOf(currentUrl)) : 0;

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!selected) { setAiOpen(false); setAiPrompt(''); }
  }, [selected]);

  useEffect(() => {
    if (aiLoading) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [aiLoading]);

  async function runAIEdit() {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      // 1. Render the image + any overlapping strokes onto an offscreen canvas
      const dataUrl = await captureItemWithStrokes(item, strokes, view);
      // 2. Send to server → OpenAI
      const result = await api.aiImageEdit(dataUrl, aiPrompt.trim());
      // 3. Push new URL into version list and make it current
      const newVersions = [...versions, result.url];
      onUpdate({ data: { ...d, url: result.url, versions: newVersions } });
      setAiOpen(false);
      setAiPrompt('');
    } catch (e) {
      alert(`AI edit failed: ${(e as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  }

  function switchVersion(idx: number) {
    const url = versions[idx];
    if (!url) return;
    onUpdate({ data: { ...d, url, versions } });
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
      {/* Main image */}
      <img
        src={currentUrl}
        alt=""
        draggable={false}
        className="w-full h-full object-cover rounded-2xl pointer-events-none"
        style={{ boxShadow: selected ? '0 0 0 2.5px #D97435, 0 8px 28px rgba(26,21,16,0.13)' : '0 2px 10px rgba(26,21,16,0.09)' }}
      />

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
          className="absolute bottom-10 left-0 right-0 mx-2 rounded-xl p-2 flex gap-1.5 z-30"
          style={{ background: 'rgba(253,250,245,0.97)', boxShadow: '0 4px 18px rgba(26,21,16,0.15)', border: '1px solid rgba(26,21,16,0.08)' }}
        >
          <input
            autoFocus
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runAIEdit(); if (e.key === 'Escape') setAiOpen(false); }}
            placeholder="Describe the edit…"
            className="flex-1 min-w-0 text-[11px] bg-transparent outline-none text-ink placeholder:text-ink/35"
            style={{ fontFamily: 'inherit' }}
          />
          <button
            onClick={runAIEdit}
            disabled={!aiPrompt.trim()}
            className="h-6 px-2.5 rounded-lg text-[10px] font-bold text-white transition-all disabled:opacity-40 shrink-0"
            style={{ background: '#D97435' }}
          >
            Go
          </button>
        </div>
      )}

      {/* Version history — small dots + arrows at top-right */}
      {selected && versions.length > 1 && (
        <div
          data-no-item-drag
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full px-2 py-1 z-20"
          style={{ background: 'rgba(253,250,245,0.92)', border: '1px solid rgba(26,21,16,0.10)', boxShadow: '0 2px 8px rgba(26,21,16,0.10)' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); switchVersion(Math.max(0, currentIdx - 1)); }}
            disabled={currentIdx === 0}
            className="w-4 h-4 flex items-center justify-center text-ink/50 hover:text-ink disabled:opacity-25 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 1L2 4l3 3" />
            </svg>
          </button>
          {versions.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); switchVersion(i); }}
              title={i === 0 ? 'Original' : `AI edit ${i}`}
              className="transition-all rounded-full"
              style={{
                width: i === currentIdx ? 7 : 5,
                height: i === currentIdx ? 7 : 5,
                background: i === currentIdx ? '#D97435' : 'rgba(26,21,16,0.25)',
              }}
            />
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); switchVersion(Math.min(versions.length - 1, currentIdx + 1)); }}
            disabled={currentIdx === versions.length - 1}
            className="w-4 h-4 flex items-center justify-center text-ink/50 hover:text-ink disabled:opacity-25 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 1l3 3-3 3" />
            </svg>
          </button>
          <span className="text-[9px] text-ink/40 font-medium ml-0.5">
            {currentIdx === 0 ? 'orig' : `v${currentIdx}`}
          </span>
        </div>
      )}
    </div>
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

  const d = item.data as Partial<ImageData>;
  const url = d.url;

  // Draw the image
  if (url) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Letterbox into square
        const ar = img.naturalWidth / img.naturalHeight;
        let dx = 0, dy = 0, dw = SIZE, dh = SIZE;
        if (ar > 1) { dh = SIZE / ar; dy = (SIZE - dh) / 2; }
        else        { dw = SIZE * ar; dx = (SIZE - dw) / 2; }
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
    // Scale factor: world coords → canvas pixels
    const scaleX = SIZE / item.w;
    const scaleY = SIZE / item.h;
    ctx.save();
    ctx.translate(-item.x * scaleX, -item.y * scaleY);
    ctx.scale(scaleX, scaleY);
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
  item, selected, editing, onDoneEditing, onUpdate,
}: {
  item: BaseItem; selected: boolean; editing: boolean;
  onDoneEditing: () => void; onUpdate: (p: Partial<BaseItem>) => void;
}) {
  const d = item.data as Partial<LinkData>;
  const txt = (d.title || d.url || '').toString();
  const isUrl = /^https?:\/\/\S+$/i.test(txt.trim());
  const ytId = isUrl ? youTubeId(txt.trim()) : null;

  if (editing) {
    return (
      <textarea
        autoFocus
        className="w-full h-full resize-none p-1.5 text-[14px] leading-snug bg-paper rounded-lg outline outline-2 outline-amber"
        value={txt}
        placeholder="Type text or paste a link…"
        onChange={(e) => onUpdate({ data: { url: '', title: e.target.value } })}
        onBlur={onDoneEditing}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLTextAreaElement).blur(); }}
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

  return (
    <div
      className="w-full h-full text-ink whitespace-pre-wrap cursor-text rounded-lg p-1.5"
      style={{
        fontSize: 16, fontWeight: 700, lineHeight: 1.45, letterSpacing: '-0.2px',
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
