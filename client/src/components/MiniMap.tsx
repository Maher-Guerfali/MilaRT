import type { BaseItem } from '../types';

interface Props {
  items: BaseItem[];
  view: { x: number; y: number; scale: number };
  canvasSize: { w: number; h: number };
}

const MAP_PX = 140;
const MAP_PADDING = 10;
const ITEM_TYPE_COLOR: Record<string, string> = {
  sticky: '#E8B830',
  image:  '#9b6b3a',
  link:   '#2a6ed9',
  board:  '#D97435',
};

// Square overview pinned above the zoom dock. Always visible (so the user
// can orient themselves). Items render as thin rounded rects coloured by
// type; the current viewport is outlined in amber. Read-only for now.
export default function MiniMap({ items, view, canvasSize }: Props) {
  // Compute the world bounds we want to fit. Include the current viewport
  // so the orange outline always has somewhere to sit even with no items.
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
  // Pad the world bounds a touch so things don't kiss the edge.
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const inner = MAP_PX - MAP_PADDING * 2;
  // Letterbox: scale by the dominant axis so aspect is preserved.
  const scale = Math.min(inner / worldW, inner / worldH);
  // Centre the content within the square.
  const offX = (MAP_PX - worldW * scale) / 2;
  const offY = (MAP_PX - worldH * scale) / 2;

  const project = (wx: number, wy: number) => ({
    x: offX + (wx - minX) * scale,
    y: offY + (wy - minY) * scale,
  });

  const v = project(visX, visY);
  const vw = visW * scale;
  const vh = visH * scale;

  return (
    <div
      className="absolute right-4 z-20 rounded-2xl border border-ink/10 overflow-hidden pointer-events-none"
      style={{
        bottom: 64, // sits just above the zoom dock (which is at bottom: 22)
        width: MAP_PX,
        height: MAP_PX,
        background: 'rgba(253,250,245,0.96)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 4px 18px rgba(26,21,16,0.10)',
      }}
    >
      <div className="absolute top-1.5 left-2 text-[9px] font-bold uppercase tracking-[0.08em] text-ink/40">
        Map
      </div>
      <svg width={MAP_PX} height={MAP_PX} viewBox={`0 0 ${MAP_PX} ${MAP_PX}`}>
        {items.map((it) => {
          const p = project(it.x, it.y);
          return (
            <rect
              key={it.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, it.w * scale)}
              height={Math.max(2, it.h * scale)}
              rx={1.5}
              fill={ITEM_TYPE_COLOR[it.type] || '#888'}
              opacity={0.55}
            />
          );
        })}
        {/* Current viewport — amber outline. */}
        <rect
          x={v.x}
          y={v.y}
          width={vw}
          height={vh}
          fill="rgba(217,116,53,0.10)"
          stroke="#D97435"
          strokeWidth={1.5}
          rx={2}
        />
      </svg>
    </div>
  );
}
