import { useRef } from 'react';
import type { BaseItem } from '../types';

interface Props {
  items: BaseItem[];
  view: { x: number; y: number; scale: number };
  canvasSize: { w: number; h: number };
  onNavigate: (worldX: number, worldY: number) => void;
}

const MAP_PX = 140;
const MAP_PADDING = 10;
const ITEM_TYPE_COLOR: Record<string, string> = {
  sticky: '#E8B830',
  image:  '#9b6b3a',
  link:   '#2a6ed9',
  board:  '#D97435',
};

export default function MiniMap({ items, view, canvasSize, onNavigate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const visW = canvasSize.w / view.scale;
  const visH = canvasSize.h / view.scale;
  const visX = -view.x / view.scale;
  const visY = -view.y / view.scale;

  let minX = visX, minY = visY, maxX = visX + visW, maxY = visY + visH;
  for (const it of items) {
    if (it.x < minX) minX = it.x;
    if (it.y < minY) minY = it.y;
    if (it.x + it.w > maxX) maxX = it.x + it.w;
    if (it.y + it.h > maxY) maxY = it.y + it.h;
  }
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const inner = MAP_PX - MAP_PADDING * 2;
  const mapScale = Math.min(inner / worldW, inner / worldH);
  const offX = (MAP_PX - worldW * mapScale) / 2;
  const offY = (MAP_PX - worldH * mapScale) / 2;

  const project = (wx: number, wy: number) => ({
    x: offX + (wx - minX) * mapScale,
    y: offY + (wy - minY) * mapScale,
  });

  // Convert a click position (relative to the SVG element) to world coords,
  // then call onNavigate so the canvas centres on that world point.
  function handleMapPoint(svgX: number, svgY: number) {
    const wx = (svgX - offX) / mapScale + minX;
    const wy = (svgY - offY) / mapScale + minY;
    onNavigate(wx, wy);
  }

  // Only the orange viewport rect is interactive — pointer events on the
  // background map are intentionally disabled so regular mouse movement
  // over the map doesn't produce a cursor change or accidental navigations.
  function onRectPointerDown(e: React.PointerEvent<SVGRectElement>) {
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = svgRef.current!.getBoundingClientRect();
    handleMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }
  function onRectPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!draggingRef.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    handleMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }
  function onRectPointerUp(e: React.PointerEvent<SVGRectElement>) {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const v = project(visX, visY);
  const vw = visW * mapScale;
  const vh = visH * mapScale;

  return (
    <div
      className="absolute right-4 z-20 rounded-2xl border border-ink/10 overflow-hidden"
      style={{
        bottom: 64,
        width: MAP_PX,
        height: MAP_PX,
        background: 'rgba(253,250,245,0.96)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 4px 18px rgba(26,21,16,0.10)',
      }}
    >
      <div className="absolute top-1.5 left-2 text-[9px] font-bold uppercase tracking-[0.08em] text-ink/40 pointer-events-none">
        Map
      </div>
      <svg
        ref={svgRef}
        width={MAP_PX}
        height={MAP_PX}
        viewBox={`0 0 ${MAP_PX} ${MAP_PX}`}
        style={{ display: 'block', touchAction: 'none' }}
      >
        {items.map((it) => {
          const p = project(it.x, it.y);
          return (
            <rect
              key={it.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, it.w * mapScale)}
              height={Math.max(2, it.h * mapScale)}
              rx={1.5}
              fill={ITEM_TYPE_COLOR[it.type] || '#888'}
              opacity={0.55}
            />
          );
        })}
        {/* Current viewport — draggable amber rect. */}
        <rect
          x={v.x}
          y={v.y}
          width={vw}
          height={vh}
          fill="rgba(217,116,53,0.10)"
          stroke="#D97435"
          strokeWidth={1.5}
          rx={2}
          style={{ cursor: draggingRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          onPointerDown={onRectPointerDown}
          onPointerMove={onRectPointerMove}
          onPointerUp={onRectPointerUp}
          onPointerCancel={onRectPointerUp}
        />
      </svg>
    </div>
  );
}
