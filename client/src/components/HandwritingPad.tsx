import { useEffect, useRef, useState } from 'react';
import type { BaseItem, HandwritingData, Stroke } from '../types';

interface Props {
  item: BaseItem;
  onUpdate: (patch: Partial<BaseItem>) => void;
}

const COLORS = ['#1b1b1b', '#d14b4b', '#2a6ed9', '#2fa865', '#d0a35a'];

export default function HandwritingPad({ item, onUpdate }: Props) {
  const data = item.data as Partial<HandwritingData>;
  const strokes: Stroke[] = data.strokes || [];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2);
  const [eraser, setEraser] = useState(false);

  // Redraw whenever strokes change or size changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(item.w * dpr);
    c.height = Math.floor(item.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, item.w, item.h);
    for (const s of strokes) drawStroke(ctx, s);
  }, [strokes, item.w, item.h]);

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
    if (s.points.length < 3) return;
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i += 3) {
      const x = s.points[i];
      const y = s.points[i + 1];
      const p = s.points[i + 2];
      ctx.lineWidth = s.width * (0.5 + p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function localXY(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (item.w / rect.width), y: (e.clientY - rect.top) * (item.h / rect.height) };
  }

  function onDown(e: React.PointerEvent) {
    e.stopPropagation();
    // Only finger/pen/mouse — ignore hover events.
    const { x, y } = localXY(e);
    const p = e.pressure > 0 ? e.pressure : 0.5;
    if (eraser) {
      eraseAt(x, y);
      return;
    }
    activeStroke.current = { color, width, points: [x, y, p] };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!activeStroke.current) {
      if (eraser && e.buttons) {
        const { x, y } = localXY(e);
        eraseAt(x, y);
      }
      return;
    }
    const { x, y } = localXY(e);
    const p = e.pressure > 0 ? e.pressure : 0.5;
    activeStroke.current.points.push(x, y, p);
    // Draw incrementally for low-latency feedback.
    const ctx = canvasRef.current!.getContext('2d')!;
    drawStroke(ctx, activeStroke.current);
  }
  function onUp(e: React.PointerEvent) {
    if (!activeStroke.current) return;
    const next = [...strokes, activeStroke.current];
    activeStroke.current = null;
    onUpdate({ data: { ...data, strokes: next } });
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {
      // ignore
    }
  }

  function eraseAt(x: number, y: number) {
    const r = 12;
    const kept = strokes.filter((s) => {
      for (let i = 0; i < s.points.length; i += 3) {
        const dx = s.points[i] - x;
        const dy = s.points[i + 1] - y;
        if (dx * dx + dy * dy < r * r) return false;
      }
      return true;
    });
    if (kept.length !== strokes.length) onUpdate({ data: { ...data, strokes: kept } });
  }

  function clear() {
    onUpdate({ data: { ...data, strokes: [] } });
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div
        className="flex items-center gap-1 px-2 py-1 border-b border-black/5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); setEraser(false); }}
            className="w-5 h-5 rounded-full border border-black/20"
            style={{
              background: c,
              boxShadow: color === c && !eraser ? '0 0 0 2px rgba(0,0,0,0.5)' : 'none',
            }}
            aria-label={`Ink ${c}`}
          />
        ))}
        <input
          type="range" min={1} max={8} value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="w-16 ml-2"
        />
        <button
          onClick={() => setEraser((x) => !x)}
          className={`text-xs px-2 py-0.5 rounded border ${eraser ? 'bg-ink text-paper border-ink' : 'border-ink/20'}`}
        >Erase</button>
        <button
          onClick={clear}
          className="text-xs px-2 py-0.5 rounded border border-ink/20 ml-auto"
        >Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        className="flex-1 w-full h-full bg-white rounded-b-xl"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  );
}
