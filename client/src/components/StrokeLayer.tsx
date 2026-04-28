import { useRef, useState } from 'react';
import type { Stroke } from '../types';

interface Props {
  view: { x: number; y: number; scale: number };
  strokes: Stroke[];
  drawMode: boolean;
  color: string;
  width: number;
  eraser: boolean;
  penOnly: boolean;
  onChange: (next: Stroke[]) => void;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
}

export default function StrokeLayer({
  view, strokes, drawMode, color, width, eraser, penOnly, onChange, toWorld,
}: Props) {
  // The active stroke lives in a ref (always synchronously up to date) and
  // is mirrored into state only to trigger a render. The previous setState-
  // only approach lost the first move of fast strokes because pointermove
  // could fire before React committed the pointerdown's setState, and the
  // functional updater would then early-return on s===null.
  const activeRef = useRef<Stroke | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const drawingRef = useRef(false);

  function strokeToPath(s: Stroke) {
    if (s.points.length < 3) return '';
    let d = '';
    for (let i = 0; i < s.points.length; i += 3) {
      d += (i === 0 ? 'M' : 'L') + s.points[i].toFixed(1) + ' ' + s.points[i + 1].toFixed(1);
    }
    return d;
  }

  // Single-point strokes (taps, periods, accents) need to render as a dot.
  function strokeIsDot(s: Stroke) {
    return s.points.length >= 3 && s.points.length < 6;
  }

  function eraseAt(wx: number, wy: number) {
    const r = 14 / view.scale;
    const r2 = r * r;
    const kept = strokes.filter((s) => {
      for (let i = 0; i < s.points.length; i += 3) {
        const dx = s.points[i] - wx;
        const dy = s.points[i + 1] - wy;
        if (dx * dx + dy * dy < r2) return false;
      }
      return true;
    });
    if (kept.length !== strokes.length) onChange(kept);
  }

  function onDown(e: React.PointerEvent) {
    if (!drawMode) return;
    if (penOnly && e.pointerType !== 'pen') return;
    e.stopPropagation();
    drawingRef.current = true;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const p = e.pressure > 0 ? e.pressure : 0.5;
    if (eraser) {
      eraseAt(x, y);
    } else {
      activeRef.current = { color, width, points: [x, y, p] };
      rerender();
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onMove(e: React.PointerEvent) {
    if (!drawMode || !drawingRef.current) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (eraser) {
      eraseAt(x, y);
      return;
    }
    const a = activeRef.current;
    if (!a) return;
    // Skip exact-duplicate points to keep paths compact.
    const n = a.points.length;
    if (n >= 3 && a.points[n - 3] === x && a.points[n - 2] === y) return;
    const p = e.pressure > 0 ? e.pressure : 0.5;
    a.points.push(x, y, p);
    rerender();
  }

  function onUp(e: React.PointerEvent) {
    drawingRef.current = false;
    const a = activeRef.current;
    // Save any stroke that has at least one real point (3 numbers).
    // Previously we discarded < 6 points which threw away quick taps and
    // tiny letters — that was the "50% of the time it doesn't work" bug.
    if (a && a.points.length >= 3) {
      onChange([...strokes, a]);
    }
    activeRef.current = null;
    rerender();
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const active = activeRef.current;

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: drawMode ? 'auto' : 'none', touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {strokes.map((s, i) => (
          strokeIsDot(s) ? (
            <circle
              key={i}
              cx={s.points[0]}
              cy={s.points[1]}
              r={Math.max(1, s.width * (0.5 + (s.points[2] || 0.5)))}
              fill={s.color}
            />
          ) : (
            <path
              key={i}
              d={strokeToPath(s)}
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              style={{ pointerEvents: 'none' }}
            />
          )
        ))}
        {active && active.points.length >= 3 && (
          active.points.length < 6 ? (
            <circle
              cx={active.points[0]}
              cy={active.points[1]}
              r={Math.max(1, active.width * (0.5 + (active.points[2] || 0.5)))}
              fill={active.color}
            />
          ) : (
            <path
              d={strokeToPath(active)}
              stroke={active.color}
              strokeWidth={active.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              style={{ pointerEvents: 'none' }}
            />
          )
        )}
      </g>
    </svg>
  );
}
