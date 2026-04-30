import { useRef, useState } from 'react';
import type { Stroke, StrokeTool } from '../types';

interface Props {
  view: { x: number; y: number; scale: number };
  strokes: Stroke[];
  drawMode: boolean;
  color: string;
  width: number;
  tool: string; // narrowed to StrokeTool when valid
  eraser: boolean;
  penOnly: boolean;
  onChange: (next: Stroke[]) => void;
  onAddStroke: (s: Stroke) => void;
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
}

// Per-tool render style. Pressure (p) varies along the stroke; for static
// rendering we use the average so each path renders with one width.
function styleForStroke(s: Stroke): { strokeWidth: number; opacity: number; dasharray?: string } {
  const tool = (s.tool || 'pen') as StrokeTool;
  const avgP = avgPressure(s);
  const w = s.width;
  switch (tool) {
    case 'pen':      return { strokeWidth: w, opacity: 1 };
    case 'fountain': return { strokeWidth: w * (0.5 + avgP), opacity: 1 };
    case 'pencil':   return { strokeWidth: w * 0.9, opacity: 0.6 };
    case 'marker':   return { strokeWidth: w * 1.2, opacity: 0.55 };
    case 'brush':    return { strokeWidth: w * (0.6 + avgP), opacity: 0.85 };
  }
}

function avgPressure(s: Stroke) {
  let sum = 0; let n = 0;
  for (let i = 2; i < s.points.length; i += 3) { sum += s.points[i]; n++; }
  return n ? sum / n : 0.5;
}

export default function StrokeLayer({
  view, strokes, drawMode, color, width, tool, eraser, penOnly, onChange, onAddStroke, toWorld,
}: Props) {
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
      activeRef.current = { color, width, tool: tool as StrokeTool, points: [x, y, p] };
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
    const n = a.points.length;
    if (n >= 3 && a.points[n - 3] === x && a.points[n - 2] === y) return;
    const p = e.pressure > 0 ? e.pressure : 0.5;
    a.points.push(x, y, p);
    rerender();
  }
  function onUp(e: React.PointerEvent) {
    drawingRef.current = false;
    const a = activeRef.current;
    if (a && a.points.length >= 3) onAddStroke(a);
    activeRef.current = null;
    rerender();
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function renderStroke(s: Stroke, key: string | number) {
    const style = styleForStroke(s);
    if (s.points.length < 6) {
      // dot
      return (
        <circle
          key={key}
          cx={s.points[0]}
          cy={s.points[1]}
          r={Math.max(1, style.strokeWidth * 0.6)}
          fill={s.color}
          opacity={style.opacity}
        />
      );
    }
    return (
      <path
        key={key}
        d={strokeToPath(s)}
        stroke={s.color}
        strokeWidth={style.strokeWidth}
        strokeLinecap={s.tool === 'marker' ? 'butt' : 'round'}
        strokeLinejoin="round"
        fill="none"
        opacity={style.opacity}
        strokeDasharray={style.dasharray}
        style={{ pointerEvents: 'none' }}
      />
    );
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
        {strokes.map((s, i) => renderStroke(s, i))}
        {active && active.points.length >= 3 && renderStroke(active, 'active')}
      </g>
    </svg>
  );
}
