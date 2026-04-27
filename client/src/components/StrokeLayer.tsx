import { useRef, useState } from 'react';
import type { Stroke } from '../types';

interface Props {
  view: { x: number; y: number; scale: number };
  strokes: Stroke[];
  drawMode: boolean;
  color: string;
  width: number;
  eraser: boolean;
  onChange: (next: Stroke[]) => void;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
}

export default function StrokeLayer({
  view, strokes, drawMode, color, width, eraser, onChange, toWorld,
}: Props) {
  const [active, setActive] = useState<Stroke | null>(null);

  function strokeToPath(s: Stroke) {
    if (s.points.length < 3) return '';
    let d = '';
    for (let i = 0; i < s.points.length; i += 3) {
      d += (i === 0 ? 'M' : 'L') + s.points[i].toFixed(1) + ' ' + s.points[i + 1].toFixed(1);
    }
    return d;
  }

  // Erase by removing any stroke that has a point near the cursor (in world coords).
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

  const drawingRef = useRef(false);

  function onDown(e: React.PointerEvent) {
    if (!drawMode) return;
    e.stopPropagation();
    drawingRef.current = true;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const p = e.pressure > 0 ? e.pressure : 0.5;
    if (eraser) {
      eraseAt(x, y);
    } else {
      setActive({ color, width, points: [x, y, p] });
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drawMode || !drawingRef.current) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (eraser) {
      eraseAt(x, y);
      return;
    }
    setActive((s) => {
      if (!s) return s;
      const last = s.points;
      // Skip duplicate points (mostly stationary fingers).
      if (last.length >= 3 && last[last.length - 3] === x && last[last.length - 2] === y) return s;
      const p = e.pressure > 0 ? e.pressure : 0.5;
      return { ...s, points: [...last, x, y, p] };
    });
  }
  function onUp(e: React.PointerEvent) {
    drawingRef.current = false;
    if (active && active.points.length >= 6) {
      onChange([...strokes, active]);
    }
    setActive(null);
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

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
          <path
            key={i}
            d={strokeToPath(s)}
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {active && (
          <path
            d={strokeToPath(active)}
            stroke={active.color}
            strokeWidth={active.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </g>
    </svg>
  );
}
