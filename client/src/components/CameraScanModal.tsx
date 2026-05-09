import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { api } from '../api';
import type { BaseItem, Stroke } from '../types';
import { CameraIcon, ImageIcon, CloseIcon } from './icons';

interface Props {
  /** World-space centre of the current viewport — items land here. */
  getCenter: () => { x: number; y: number };
  onCommit: (items: BaseItem[]) => void;
  /** Optional: receive traced handwriting strokes (handwriting import mode). */
  onCommitStrokes?: (strokes: Stroke[]) => void;
  onClose: () => void;
}

type ImportMode = 'digital' | 'handwriting';

type ScanBlock = {
  kind: 'sticky' | 'text';
  text: string;
  color: string | null;
  bbox: { x: number; y: number; w: number; h: number };
};

const STICKY_FALLBACK = '#FFF3C4';
const TARGET_REGION_WIDTH = 1400;     // world px the photo's full width maps to
const MIN_W = 120;
const MIN_H = 56;
const MAX_UPLOAD_PX = 1568;           // resize before sending to keep tokens down

// Resize an image File/Blob to fit within MAX_UPLOAD_PX on its longest edge,
// re-encoded as JPEG data URL for compactness. Returns { dataUrl, w, h }.
async function fileToCompressedDataUrl(file: Blob): Promise<{ dataUrl: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_UPLOAD_PX ? MAX_UPLOAD_PX / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { dataUrl, w, h };
}

function blocksToItems(
  blocks: ScanBlock[],
  photoAspect: number,
  centre: { x: number; y: number },
): BaseItem[] {
  const regionW = TARGET_REGION_WIDTH;
  const regionH = regionW / photoAspect;
  const left = centre.x - regionW / 2;
  const top = centre.y - regionH / 2;

  return blocks
    .filter((b) => b.text && b.text.trim().length > 0 && b.bbox)
    .map((b, idx): BaseItem => {
      const bx = clamp01(b.bbox.x);
      const by = clamp01(b.bbox.y);
      const bw = clamp01(b.bbox.w);
      const bh = clamp01(b.bbox.h);
      const x = left + bx * regionW;
      const y = top + by * regionH;
      const w = Math.max(MIN_W, bw * regionW);
      const h = Math.max(MIN_H, bh * regionH);

      if (b.kind === 'sticky') {
        return {
          id: nanoid(10),
          type: 'sticky',
          x, y, w, h,
          z: idx,
          data: { text: b.text.trim(), color: b.color || STICKY_FALLBACK },
        };
      }
      // Free text → "link with no URL", matching the Sidebar Text button convention.
      return {
        id: nanoid(10),
        type: 'link',
        x, y, w, h,
        z: idx,
        data: { url: '', title: b.text.trim() },
      };
    });
}

function clamp01(n: number) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// Crop one block from the photo into its own canvas, sample the dominant ink
// colour from the dark pixels (so red pen stays red), and return a PNG data
// URL ready for the trace endpoint.
function cropBlock(
  source: ImageBitmap,
  bbox: ScanBlock['bbox'],
): { dataUrl: string; color: string; w: number; h: number } | null {
  const W = source.width, H = source.height;
  const sx = Math.max(0, Math.floor(clamp01(bbox.x) * W));
  const sy = Math.max(0, Math.floor(clamp01(bbox.y) * H));
  const sw = Math.max(2, Math.floor(clamp01(bbox.w) * W));
  const sh = Math.max(2, Math.floor(clamp01(bbox.h) * H));
  const cw = Math.min(sw, W - sx);
  const ch = Math.min(sh, H - sy);
  if (cw < 4 || ch < 4) return null;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, cw, ch);

  const data = ctx.getImageData(0, 0, cw, ch).data;
  const color = inkColorFromPixels(data);
  return { dataUrl: canvas.toDataURL('image/png'), color, w: cw, h: ch };
}

// Pick the average colour of the darkest 25% of pixels — that's almost always
// the ink, regardless of paper / sticky background.
function inkColorFromPixels(data: Uint8ClampedArray): string {
  const lums: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    lums.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  if (!lums.length) return '#1a1510';
  const sorted = [...lums].sort((a, b) => a - b);
  const cutoff = sorted[Math.floor(sorted.length * 0.25)];
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (lums[p] > cutoff) continue;
    sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; n++;
  }
  if (n < 4) return '#1a1510';
  const r = Math.round(sumR / n);
  const g = Math.round(sumG / n);
  const b = Math.round(sumB / n);
  return rgbToHex(r, g, b);
}

function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Map polylines from a single block's crop coords (px in cw × ch) into
// world-space Stroke objects placed at the same world position the digital
// items would have used.
function tracesToStrokes(
  traces: Array<{ index: number; polylines: number[][] }>,
  blocks: ScanBlock[],
  blockMeta: Array<{ color: string; cropW: number; cropH: number } | null>,
  photoAspect: number,
  centre: { x: number; y: number },
): Stroke[] {
  const regionW = TARGET_REGION_WIDTH;
  const regionH = regionW / photoAspect;
  const left = centre.x - regionW / 2;
  const top = centre.y - regionH / 2;
  const out: Stroke[] = [];
  const STROKE_W = 2.4;

  for (const t of traces) {
    const block = blocks[t.index];
    const meta = blockMeta[t.index];
    if (!block || !meta) continue;
    const bx = clamp01(block.bbox.x);
    const by = clamp01(block.bbox.y);
    const bw = clamp01(block.bbox.w);
    const bh = clamp01(block.bbox.h);

    for (const poly of t.polylines) {
      if (poly.length < 4) continue;
      const points: number[] = [];
      for (let i = 0; i < poly.length; i += 2) {
        const px = poly[i] / meta.cropW;
        const py = poly[i + 1] / meta.cropH;
        const nx = bx + px * bw;
        const ny = by + py * bh;
        const wx = left + nx * regionW;
        const wy = top + ny * regionH;
        points.push(wx, wy, 0.6);
      }
      out.push({ color: meta.color, width: STROKE_W, tool: 'pen', points });
    }
  }
  return out;
}

type Stage = 'pick' | 'preview' | 'scanning' | 'review' | 'tracing' | 'error';

export default function CameraScanModal({ getCenter, onCommit, onCommitStrokes, onClose }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('pick');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgAspect, setImgAspect] = useState<number>(1);
  const [compressed, setCompressed] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ScanBlock[]>([]);
  const [explanation, setExplanation] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<ImportMode>('digital');

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    try {
      const { dataUrl, w, h } = await fileToCompressedDataUrl(file);
      setCompressed(dataUrl);
      setPreviewUrl(dataUrl);
      setImgAspect(w / h);
      setStage('preview');
    } catch (e) {
      setErrorMsg(`Couldn't read that image: ${(e as Error).message}`);
      setStage('error');
    }
  }

  async function runScan() {
    if (!compressed) return;
    setStage('scanning');
    try {
      const res = await api.aiWhiteboardScan(compressed);
      const found = res.blocks ?? [];
      setBlocks(found);
      setExplanation(res.explanation || '');
      setAccepted(new Set(found.map((_, i) => i)));
      setStage(found.length ? 'review' : 'error');
      if (!found.length) setErrorMsg("Couldn't find any readable content in this photo.");
    } catch (e) {
      setErrorMsg(`Scan failed: ${(e as Error).message}`);
      setStage('error');
    }
  }

  async function commit() {
    const acceptedIndices = blocks
      .map((_, i) => i)
      .filter((i) => accepted.has(i));
    if (!acceptedIndices.length) { onClose(); return; }
    const chosen = acceptedIndices.map((i) => blocks[i]);
    const centre = getCenter();

    if (mode === 'digital' || !onCommitStrokes || !compressed) {
      const items = blocksToItems(chosen, imgAspect, centre);
      if (items.length) onCommit(items);
      onClose();
      return;
    }

    // Handwriting mode: crop each accepted block, send to /trace, and convert
    // the returned polylines to strokes. Any block that produces zero strokes
    // silently falls back to a digital text/sticky item so nothing is lost.
    setStage('tracing');
    try {
      const bitmap = await fetch(compressed).then((r) => r.blob()).then(createImageBitmap);
      const metas: Array<{ color: string; cropW: number; cropH: number } | null> = [];
      const regions: { dataUrl: string }[] = [];
      const regionToAcceptedIdx: number[] = [];
      for (let k = 0; k < chosen.length; k++) {
        const cropped = cropBlock(bitmap, chosen[k].bbox);
        if (!cropped) { metas.push(null); continue; }
        metas.push({ color: cropped.color, cropW: cropped.w, cropH: cropped.h });
        regions.push({ dataUrl: cropped.dataUrl });
        regionToAcceptedIdx.push(k);
      }

      const { traces } = await api.aiWhiteboardTrace(regions);
      // Re-map trace.index (region index) back to chosen-block index.
      const remapped = traces.map((t) => ({
        index: regionToAcceptedIdx[t.index] ?? -1,
        polylines: t.polylines,
      })).filter((t) => t.index >= 0);

      const strokes = tracesToStrokes(remapped, chosen, metas, imgAspect, centre);

      // Blocks the trace produced nothing for → fall back to digital text
      // so the user doesn't silently lose them.
      const tracedSet = new Set(remapped.map((t) => t.index));
      const fallbackBlocks = chosen.filter((_, i) => !tracedSet.has(i));
      const fallbackItems = blocksToItems(fallbackBlocks, imgAspect, centre);

      if (strokes.length) onCommitStrokes(strokes);
      if (fallbackItems.length) onCommit(fallbackItems);
      onClose();
    } catch (e) {
      setErrorMsg(`Trace failed: ${(e as Error).message}`);
      setStage('error');
    }
  }

  function toggleBlock(i: number) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4"
      style={{ background: 'rgba(26,21,16,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-ink/10 flex flex-col overflow-hidden"
        style={{ background: '#FDFAF5', boxShadow: '0 24px 60px rgba(26,21,16,0.25)' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-ink/8 flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(217,116,53,0.12)' }}
          >
            <span style={{ color: '#D97435' }}><CameraIcon size={18} /></span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ink">Scan a whiteboard</p>
            <p className="text-[12px] text-ink/60 mt-0.5 leading-snug">
              Snap or upload a photo of a whiteboard, sticky-note wall, or notebook page.
              The AI turns it into editable notes on your canvas.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink/40 hover:text-ink/70 p-1 -mr-1 -mt-1"
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Body */}
        {stage === 'pick' && (
          <div className="px-5 py-5 grid grid-cols-2 gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 h-32 rounded-xl border border-ink/12 hover:bg-ink/5 transition-colors text-ink/80"
            >
              <CameraIcon size={26} />
              <span className="text-[12px] font-semibold">Take photo</span>
            </button>
            <button
              onClick={() => galleryRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 h-32 rounded-xl border border-ink/12 hover:bg-ink/5 transition-colors text-ink/80"
            >
              <ImageIcon size={26} />
              <span className="text-[12px] font-semibold">Upload from device</span>
            </button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        )}

        {stage === 'preview' && previewUrl && (
          <>
            <div className="px-5 py-4">
              <img
                src={previewUrl}
                alt="Whiteboard preview"
                className="w-full max-h-[50vh] object-contain rounded-xl border border-ink/10"
              />
            </div>
            <div className="px-4 pb-4 pt-1 flex gap-2">
              <button
                onClick={() => { setPreviewUrl(null); setCompressed(null); setStage('pick'); }}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
              >
                Pick different
              </button>
              <button
                onClick={runScan}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors"
                style={{ background: '#D97435' }}
              >
                Scan with AI
              </button>
            </div>
          </>
        )}

        {stage === 'scanning' && (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-ink/60">
            <Spinner />
            <p className="text-[12.5px]">Reading the whiteboard…</p>
          </div>
        )}

        {stage === 'tracing' && (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-ink/60">
            <Spinner />
            <p className="text-[12.5px]">Tracing the handwriting…</p>
          </div>
        )}

        {stage === 'review' && (
          <>
            {explanation && (
              <p className="px-5 pt-3 text-[12px] text-ink/60 italic">{explanation}</p>
            )}
            {onCommitStrokes && (
              <div className="px-5 pt-3">
                <div className="flex p-0.5 rounded-xl border border-ink/12 bg-ink/[0.03] text-[11.5px] font-semibold">
                  <button
                    onClick={() => setMode('digital')}
                    className={`flex-1 h-7 rounded-lg transition-colors ${
                      mode === 'digital' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Digital text
                  </button>
                  <button
                    onClick={() => setMode('handwriting')}
                    className={`flex-1 h-7 rounded-lg transition-colors ${
                      mode === 'handwriting' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Original handwriting
                  </button>
                </div>
                <p className="text-[11px] text-ink/45 mt-1.5 leading-snug">
                  {mode === 'digital'
                    ? 'Imports as typed sticky notes and text — fully editable.'
                    : 'Imports as editable pencil strokes that mirror the original handwriting. Use the eraser to remove parts.'}
                </p>
              </div>
            )}
            <div className="px-4 py-3 flex flex-col gap-1.5 max-h-[45vh] overflow-y-auto">
              {blocks.map((b, i) => {
                const on = accepted.has(i);
                const isSticky = b.kind === 'sticky';
                return (
                  <button
                    key={i}
                    onClick={() => toggleBlock(i)}
                    className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-[12px] transition-colors ${
                      on
                        ? 'border-ink/20 bg-ink/[0.03]'
                        : 'border-ink/10 bg-ink/[0.02] opacity-50'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-sm mt-0.5 shrink-0 border border-ink/15"
                      style={{ background: isSticky ? (b.color || STICKY_FALLBACK) : '#FDFAF5' }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block uppercase text-[9px] font-bold tracking-wider text-ink/40 mb-0.5">
                        {isSticky ? 'Sticky' : 'Text'}
                      </span>
                      <span className="block whitespace-pre-wrap break-words text-ink/85 leading-snug">
                        {b.text}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-ink/8">
              <button
                onClick={onClose}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={accepted.size === 0}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors disabled:opacity-40"
                style={{ background: '#D97435' }}
              >
                Add {accepted.size} to canvas
              </button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="px-5 py-6 text-[12.5px] text-ink/70 leading-snug">
              {errorMsg || 'Something went wrong.'}
            </div>
            <div className="px-4 pb-4 pt-0 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setErrorMsg(''); setStage('pick'); }}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors"
                style={{ background: '#D97435' }}
              >
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="rgba(26,21,16,0.12)" strokeWidth="2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="#D97435"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
