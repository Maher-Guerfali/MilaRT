import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { api } from '../api';
import type { BaseItem, Stroke } from '../types';
import { CameraIcon, ImageIcon, CloseIcon } from './icons';
import { traceSkeleton } from '../lib/skeletonTrace';

interface Props {
  /** World-space centre of the current viewport — items land here. */
  /** Returns the current viewport in world units so imported content can be
   *  sized to roughly fit on screen rather than using a fixed world-px box. */
  getViewport: () => { centerX: number; centerY: number; worldW: number; worldH: number };
  onCommit: (items: BaseItem[]) => void;
  /** Optional: receive traced handwriting strokes (handwriting import mode). */
  onCommitStrokes?: (strokes: Stroke[]) => void;
  onClose: () => void;
}

// Two import strategies:
//   'text' → OCR only. Text becomes handwriting-font items. Drawings ignored.
//   'mix'  → OCR text → handwriting-font items + skeleton-trace whatever
//            isn't text into single-line pen strokes.
type ImportMode = 'text' | 'mix';

type ScanBlock = {
  kind: 'sticky' | 'text';
  text: string;
  color: string | null;
  bbox: { x: number; y: number; w: number; h: number };
};

const STICKY_FALLBACK = '#FFF3C4';
// Fraction of the visible viewport the imported photo should occupy. Leaves a
// margin so the user has headroom to zoom further out without re-fitting.
const VIEWPORT_FIT = 0.85;
// Floor / ceiling on the world-px width we'll pick — keeps very tiny or huge
// viewports from producing unusable results.
const REGION_W_MIN = 600;
const REGION_W_MAX = 3000;
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

// Pick a region width so a photo of `photoAspect` fits within VIEWPORT_FIT of
// the visible viewport — bounded to the REGION_W_MIN..MAX range.
function fitRegionWidth(
  photoAspect: number,
  viewport: { worldW: number; worldH: number },
): number {
  const byWidth = viewport.worldW * VIEWPORT_FIT;
  const byHeight = viewport.worldH * VIEWPORT_FIT * photoAspect;
  const raw = Math.min(byWidth, byHeight);
  return Math.max(REGION_W_MIN, Math.min(REGION_W_MAX, raw));
}

function blocksToItems(
  blocks: ScanBlock[],
  photoAspect: number,
  viewport: { centerX: number; centerY: number; worldW: number; worldH: number },
  options?: { handwriting?: boolean },
): BaseItem[] {
  const regionW = fitRegionWidth(photoAspect, viewport);
  const regionH = regionW / photoAspect;
  const left = viewport.centerX - regionW / 2;
  const top = viewport.centerY - regionH / 2;
  const handwriting = options?.handwriting === true;

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
      // Pick a font size that fills the bbox roughly the way the original
      // handwriting did. Divide by line count so multi-line blocks don't
      // pick a giant font that overflows vertically.
      const text = b.text.trim();
      const lineCount = (text.match(/\n/g)?.length ?? 0) + 1;
      const fontSize = handwriting
        ? Math.max(12, Math.min(48, (h / lineCount) / 1.35))
        : undefined;

      if (b.kind === 'sticky') {
        return {
          id: nanoid(10),
          type: 'sticky',
          x, y, w, h,
          z: idx,
          data: {
            text,
            color: b.color || STICKY_FALLBACK,
            ...(handwriting ? { font: 'handwriting' as const, fontSize } : {}),
          },
        };
      }
      // Free text → "link with no URL", matching the Sidebar Text button convention.
      return {
        id: nanoid(10),
        type: 'link',
        x, y, w, h,
        z: idx,
        data: {
          url: '',
          title: text,
          ...(handwriting ? { font: 'handwriting' as const, fontSize } : {}),
        },
      };
    });
}

function clamp01(n: number) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// Trace the photo to centerline pen strokes. We:
//   1. Binarize using colour-distance background removal (handles coloured
//      ink that pure luminance Otsu would miss).
//   2. Zero out any text bboxes from the mask so the OCR'd letters don't get
//      double-rendered as strokes too.
//   3. Run client-side skeleton tracing (see lib/skeletonTrace) which returns
//      single-line polylines + an ink-thickness estimate.
//   4. Project polylines from mask px → world coords and emit Stroke[] sized
//      so the pen width matches what was on the paper.
async function tracePhotoToStrokes(
  bitmap: ImageBitmap,
  photoAspect: number,
  viewport: { centerX: number; centerY: number; worldW: number; worldH: number },
  maskBboxes?: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<{ strokes: Stroke[]; inkColor: string }> {
  const W = bitmap.width;
  const H = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { strokes: [], inkColor: '#1a1510' };
  ctx.drawImage(bitmap, 0, 0);

  const orig = ctx.getImageData(0, 0, W, H);
  const { inkColor, mask } = extractInkMask(orig.data);
  const colorHex = rgbToHex(inkColor.r, inkColor.g, inkColor.b);

  // Erase text bbox regions from the mask before skeletonizing — only the
  // non-text drawings (boxes, arrows, freehand) become strokes.
  if (maskBboxes && maskBboxes.length) {
    for (const b of maskBboxes) {
      const padPx = Math.round(0.005 * Math.max(W, H));   // ~0.5% padding
      const x0 = Math.max(0, Math.floor(clamp01(b.x) * W) - padPx);
      const y0 = Math.max(0, Math.floor(clamp01(b.y) * H) - padPx);
      const x1 = Math.min(W, Math.ceil((clamp01(b.x) + clamp01(b.w)) * W) + padPx);
      const y1 = Math.min(H, Math.ceil((clamp01(b.y) + clamp01(b.h)) * H) + padPx);
      for (let y = y0; y < y1; y++) {
        const row = y * W;
        for (let x = x0; x < x1; x++) mask[row + x] = 0;
      }
    }
  }

  const trace = traceSkeleton(mask, W, H);
  if (trace.polylines.length === 0) {
    return { strokes: [], inkColor: colorHex };
  }

  const regionW = fitRegionWidth(photoAspect, viewport);
  const regionH = regionW / photoAspect;
  const left = viewport.centerX - regionW / 2;
  const top = viewport.centerY - regionH / 2;
  // Convert estimated ink thickness from (downscaled) mask px to world px.
  // 0.55 is a visual fudge factor — skeleton-derived thickness slightly
  // overshoots actual pen weight because of mask noise around stroke edges.
  const maskToWorld = regionW / trace.width;
  const strokeW = Math.max(0.6, trace.inkThickness * maskToWorld * 0.55);

  const strokes: Stroke[] = [];
  for (const poly of trace.polylines) {
    const points: number[] = [];
    for (let i = 0; i < poly.length; i += 2) {
      const wx = left + (poly[i] / trace.width) * regionW;
      const wy = top + (poly[i + 1] / trace.height) * regionH;
      points.push(wx, wy, 0.6);
    }
    strokes.push({ color: colorHex, width: strokeW, tool: 'pen', points });
  }
  return { strokes, inkColor: colorHex };
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

export default function CameraScanModal({ getViewport, onCommit, onCommitStrokes, onClose }: Props) {
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
  const [mode, setMode] = useState<ImportMode>('mix');

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

  // From the preview stage, kick off OCR. Both 'text' and 'mix' modes need
  // the OCR pass — the mode only changes what we do *after* the review step.
  async function proceed() {
    if (!compressed) return;
    setStage('scanning');
    try {
      const res = await api.aiWhiteboardScan(compressed);
      const found = res.blocks ?? [];
      setBlocks(found);
      setExplanation(res.explanation || '');
      setAccepted(new Set(found.map((_, i) => i)));
      if (found.length === 0 && mode === 'text') {
        setErrorMsg("Couldn't find any readable text in this photo.");
        setStage('error');
        return;
      }
      // Mix mode with no text is still fine — we'll just trace the whole image.
      setStage(found.length || mode === 'text' ? 'review' : 'tracing');
      if (mode === 'mix' && found.length === 0) {
        await runTrace([]);
      }
    } catch (e) {
      setErrorMsg(`Scan failed: ${(e as Error).message}`);
      setStage('error');
    }
  }

  // Commit the accepted OCR blocks as handwriting-font text items. In 'mix'
  // mode we then run the skeleton trace, masking out the bboxes of the text
  // we just committed so we don't double-render letters as pen strokes.
  async function commitReview() {
    const chosen = blocks.filter((_, i) => accepted.has(i));
    const items = blocksToItems(chosen, imgAspect, getViewport(), { handwriting: true });
    if (items.length) onCommit(items);

    if (mode === 'mix' && onCommitStrokes) {
      setStage('tracing');
      await runTrace(chosen.map((b) => b.bbox));
      return;
    }
    onClose();
  }

  // Skeleton-trace the original photo, masking out the given text bboxes.
  async function runTrace(maskBboxes: Array<{ x: number; y: number; w: number; h: number }>) {
    if (!onCommitStrokes || !compressed) { onClose(); return; }
    try {
      const bitmap = await fetch(compressed).then((r) => r.blob()).then(createImageBitmap);
      const aspect = bitmap.width / bitmap.height;
      const { strokes } = await tracePhotoToStrokes(bitmap, aspect, getViewport(), maskBboxes);
      if (strokes.length) onCommitStrokes(strokes);
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
            <div className="px-5 pt-4 pb-3">
              <img
                src={previewUrl}
                alt="Whiteboard preview"
                className="w-full max-h-[42vh] object-contain rounded-xl border border-ink/10"
              />
            </div>
            {onCommitStrokes && (
              <div className="px-5 pb-2">
                <div className="flex p-0.5 rounded-xl border border-ink/12 bg-ink/[0.03] text-[12px] font-semibold">
                  <button
                    onClick={() => setMode('mix')}
                    className={`flex-1 h-8 rounded-lg transition-colors ${
                      mode === 'mix' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Mix (text + drawing)
                  </button>
                  <button
                    onClick={() => setMode('text')}
                    className={`flex-1 h-8 rounded-lg transition-colors ${
                      mode === 'text' ? 'bg-white text-ink shadow-sm' : 'text-ink/55'
                    }`}
                  >
                    Text only
                  </button>
                </div>
                <p className="text-[11px] text-ink/45 mt-1.5 leading-snug">
                  {mode === 'mix'
                    ? 'OCR’s the handwriting into a handwriting font, then traces the boxes / arrows / freehand marks as single-line pen strokes. Best for whiteboards with both.'
                    : 'OCR only — your writing becomes editable text items in a handwriting font. Drawings are ignored.'}
                </p>
              </div>
            )}
            <div className="px-4 pb-4 pt-1 flex gap-2">
              <button
                onClick={() => { setPreviewUrl(null); setCompressed(null); setStage('pick'); }}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
              >
                Pick different
              </button>
              <button
                onClick={proceed}
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
                onClick={commitReview}
                disabled={accepted.size === 0 && mode !== 'mix'}
                className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors disabled:opacity-40"
                style={{ background: '#D97435' }}
              >
                {mode === 'mix'
                  ? (accepted.size ? `Add ${accepted.size} + trace rest` : 'Trace drawings only')
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
