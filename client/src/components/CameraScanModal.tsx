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

type ImportMode = 'digital' | 'mix' | 'trace';

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

// Trace the entire photo as one image. Pre-binarizes client-side using
// colour-distance background removal (much better than potrace's built-in
// luminance Otsu — catches coloured ink and faint marks Otsu-on-luminance
// would drop). Returns Stroke[] in world coords centred on the viewport.
async function tracePhotoToStrokes(
  bitmap: ImageBitmap,
  photoAspect: number,
  centre: { x: number; y: number },
  maskBboxes?: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<Stroke[]> {
  const W = bitmap.width;
  const H = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0);

  const orig = ctx.getImageData(0, 0, W, H);
  const { inkColor, mask } = extractInkMask(orig.data);

  // Paint the binary mask back onto the canvas: ink = black, bg = white.
  const bin = ctx.createImageData(W, H);
  const bd = bin.data;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const v = mask[p] ? 0 : 255;
    bd[i] = v; bd[i + 1] = v; bd[i + 2] = v; bd[i + 3] = 255;
  }
  ctx.putImageData(bin, 0, 0);

  // White out text bboxes after binarization (only used by 'mix' mode).
  if (maskBboxes && maskBboxes.length) {
    ctx.fillStyle = 'white';
    for (const b of maskBboxes) {
      const x = Math.max(0, clamp01(b.x) * W - 4);
      const y = Math.max(0, clamp01(b.y) * H - 4);
      const w = Math.min(W - x, clamp01(b.w) * W + 8);
      const h = Math.min(H - y, clamp01(b.h) * H + 8);
      ctx.fillRect(x, y, w, h);
    }
  }

  const dataUrl = canvas.toDataURL('image/png');
  const { traces } = await api.aiWhiteboardTrace([{ dataUrl }]);

  const regionW = TARGET_REGION_WIDTH;
  const regionH = regionW / photoAspect;
  const left = centre.x - regionW / 2;
  const top = centre.y - regionH / 2;
  const STROKE_W = 1.4;
  const colorHex = rgbToHex(inkColor.r, inkColor.g, inkColor.b);

  const strokes: Stroke[] = [];
  for (const t of traces) {
    for (const poly of t.polylines) {
      if (poly.length < 4) continue;
      const points: number[] = [];
      for (let i = 0; i < poly.length; i += 2) {
        const wx = left + (poly[i] / W) * regionW;
        const wy = top + (poly[i + 1] / H) * regionH;
        points.push(wx, wy, 0.6);
      }
      strokes.push({ color: colorHex, width: STROKE_W, tool: 'pen', points });
    }
  }
  return strokes;
}

// Detect the dominant background colour, measure each pixel's RGB-space
// distance from it, and Otsu-threshold the distance histogram to split
// ink from background. Works for coloured ink (red/green/blue/highlighter)
// where luminance-only thresholding fails — coloured pen has small
// luminance change but large colour-distance from beige paper.
function extractInkMask(data: Uint8ClampedArray): {
  inkColor: { r: number; g: number; b: number };
  mask: Uint8Array;
} {
  const N = data.length / 4;

  // Background: average of the brightest 30% of pixels.
  const lums = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    lums[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const sorted = Array.from(lums).sort((a, b) => b - a);
  const bgCutoff = sorted[Math.min(sorted.length - 1, Math.floor(N * 0.3))];
  let bR = 0, bG = 0, bB = 0, bN = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (lums[p] < bgCutoff) continue;
    bR += data[i]; bG += data[i + 1]; bB += data[i + 2]; bN++;
  }
  const bg = bN
    ? { r: bR / bN, g: bG / bN, b: bB / bN }
    : { r: 240, g: 235, b: 220 };

  // Distance from bg in RGB space, scaled into 0..255 bins for Otsu.
  const dists = new Uint8ClampedArray(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    const d = Math.sqrt(dr * dr + dg * dg + db * db) / 1.732;
    dists[p] = d > 255 ? 255 : d | 0;
  }

  const threshold = Math.max(15, otsu(dists));
  const mask = new Uint8Array(N);
  let inR = 0, inG = 0, inB = 0, inN = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (dists[p] >= threshold) {
      mask[p] = 1;
      inR += data[i]; inG += data[i + 1]; inB += data[i + 2]; inN++;
    }
  }
  const inkColor = inN >= 4
    ? { r: Math.round(inR / inN), g: Math.round(inG / inN), b: Math.round(inB / inN) }
    : { r: 26, g: 21, b: 16 };
  return { inkColor, mask };
}

// Standard Otsu's method on an 8-bit histogram. Returns the bin index that
// maximises between-class variance.
function otsu(values: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  return threshold;
}

function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
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
    const chosen = acceptedIndices.map((i) => blocks[i]);
    const centre = getCenter();

    // Trace modes need the photo + the strokes channel, otherwise fall back
    // to digital so nothing is silently dropped.
    const canTrace = !!onCommitStrokes && !!compressed;
    const effectiveMode: ImportMode = canTrace ? mode : 'digital';

    if (effectiveMode === 'digital') {
      const items = blocksToItems(chosen, imgAspect, centre);
      if (items.length) onCommit(items);
      onClose();
      return;
    }

    setStage('tracing');
    try {
      const bitmap = await fetch(compressed!).then((r) => r.blob()).then(createImageBitmap);

      if (effectiveMode === 'mix') {
        // Mask text bboxes white so they don't get traced; add them back as
        // editable typed items on top.
        const maskBboxes = chosen.map((b) => b.bbox);
        const strokes = await tracePhotoToStrokes(bitmap, imgAspect, centre, maskBboxes);
        const items = blocksToItems(chosen, imgAspect, centre);
        if (strokes.length) onCommitStrokes!(strokes);
        if (items.length) onCommit(items);
      } else {
        // 'trace' — whole photo as strokes, including text. Block selection
        // is irrelevant here.
        const strokes = await tracePhotoToStrokes(bitmap, imgAspect, centre);
        if (strokes.length) onCommitStrokes!(strokes);
      }
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
                <div className="flex p-0.5 rounded-xl border border-ink/12 bg-ink/[0.03] text-[11px] font-semibold">
                  <button
                    onClick={() => setMode('digital')}
                    className={`flex-1 h-7 rounded-lg transition-colors ${
                      mode === 'digital' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Digital text
                  </button>
                  <button
                    onClick={() => setMode('mix')}
                    className={`flex-1 h-7 rounded-lg transition-colors ${
                      mode === 'mix' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Sketches + text
                  </button>
                  <button
                    onClick={() => setMode('trace')}
                    className={`flex-1 h-7 rounded-lg transition-colors ${
                      mode === 'trace' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Trace everything
                  </button>
                </div>
                <p className="text-[11px] text-ink/45 mt-1.5 leading-snug">
                  {mode === 'digital'
                    ? 'Imports as typed sticky notes and text — fully editable.'
                    : mode === 'mix'
                    ? 'Drawings come in as editable pencil strokes; recognised text comes in as typed notes.'
                    : 'Imports the entire photo as editable pencil strokes (use the eraser to fix mistakes).'}
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
                disabled={mode !== 'trace' && accepted.size === 0}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors disabled:opacity-40"
                style={{ background: '#D97435' }}
              >
                {mode === 'trace'
                  ? 'Trace photo'
                  : mode === 'mix'
                  ? `Add ${accepted.size} + sketches`
                  : `Add ${accepted.size} to canvas`}
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
