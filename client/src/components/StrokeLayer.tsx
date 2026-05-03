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

// Eraser screen-pixel radius for each size (driven by width: sm=2 md=4 lg=8).
// Maps to a comfortable circular eraser at each scale.
function eraserScreenRadius(width: number): number {
  return Math.max(width * 4, 8); // sm→8, md→16, lg→32
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
  // Eraser cursor position in world coordinates (null when pointer not over SVG)
  const [eraserPos, setEraserPos] = useState<{ wx: number; wy: number } | null>(null);

  function strokeToPath(s: Stroke) {
    if (s.points.length < 3) return '';
    let d = '';
    for (let i = 0; i < s.points.length; i += 3) {
      d += (i === 0 ? 'M' : 'L') + s.points[i].toFixed(1) + ' ' + s.points[i + 1].toFixed(1);
    }
    return d;
  }

  // Partial-stroke erasing: split each stroke at points inside the eraser circle.
  // Only the segments that lie fully outside the circle are kept as new strokes.
  function eraseAt(wx: number, wy: number) {
    const r = eraserScreenRadius(width) / view.scale;
    const r2 = r * r;
    const newStrokes: Stroke[] = [];
    let changed = false;

    for (const s of strokes) {
      const numPts = s.points.length / 3;
      // Classify each point: true = outside eraser circle
      const outside: boolean[] = [];
      for (let i = 0; i < numPts; i++) {
        const dx = s.points[i * 3] - wx;
        const dy = s.points[i * 3 + 1] - wy;
        outside.push(dx * dx + dy * dy >= r2);
      }

      if (outside.every(Boolean)) {
        // Stroke entirely outside — keep as-is
        newStrokes.push(s);
        continue;
      }

      changed = true;
      // Split into runs of consecutive outside-circle points
      let current: number[] = [];
      for (let i = 0; i < numPts; i++) {
        if (outside[i]) {
          current.push(s.points[i * 3], s.points[i * 3 + 1], s.points[i * 3 + 2]);
        } else {
          if (current.length >= 3) {
            newStrokes.push({ ...s, points: current });
          }
          current = [];
        }
      }
      if (current.length >= 3) newStrokes.push({ ...s, points: current });
    }

    if (changed) onChange(newStrokes);
  }

  function onDown(e: React.PointerEvent) {
    if (!drawMode) return;
    if (penOnly && e.pointerType !== 'pen') return;
    e.stopPropagation();
    drawingRef.current = true;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const p = e.pressure > 0 ? e.pressure : 0.5;
    if (eraser) {
      setEraserPos({ wx: x, wy: y });
      eraseAt(x, y);
    } else {
      activeRef.current = { color, width, tool: tool as StrokeTool, points: [x, y, p] };
      rerender();
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e: React.PointerEvent) {
    if (!drawMode) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (eraser) {
      setEraserPos({ wx: x, wy: y });
      if (drawingRef.current) eraseAt(x, y);
      return;
    }
    if (!drawingRef.current) return;
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
  // Eraser circle radius in world units (screen radius / scale)
  const eraserWorldR = eraser ? eraserScreenRadius(width) / view.scale : 0;

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{
        pointerEvents: drawMode ? 'auto' : 'none',
        touchAction: 'none',
        cursor: eraser && drawMode ? 'none' : 'crosshair',
        // Strokes sit just above the highest possible item z-index
        // (selected items go to 100000 + item.z). Floating UI like the
        // CanvasDock and DrawTray are bumped above this so they remain
        // clickable while drawing.
        zIndex: 150000,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setEraserPos(null)}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {strokes.map((s, i) => renderStroke(s, i))}
        {active && active.points.length >= 3 && renderStroke(active, 'active')}
        {/* Eraser circle cursor */}
        {eraser && drawMode && eraserPos && (
          <circle
            cx={eraserPos.wx}
            cy={eraserPos.wy}
            r={eraserWorldR}
            fill="rgba(255,255,255,0.55)"
            stroke="rgba(26,21,16,0.45)"
            strokeWidth={1 / view.scale}
            strokeDasharray={`${3 / view.scale} ${3 / view.scale}`}
            style={{ pointerEvents: 'none' }}
          />
        )}
      </g>
    </svg>
  );
}
