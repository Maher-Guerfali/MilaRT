import type { BaseItem, Connection } from '../types';

interface Props {
  view: { x: number; y: number; scale: number };
  items: BaseItem[];
  connections: Connection[];
  // While dragging from a source dot, the in-flight arrow follows the cursor.
  pending: { fromItemId: string; toScreenX: number; toScreenY: number } | null;
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
}

function center(item: BaseItem) {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

// Cubic-bezier between two world-space points. Returns SVG path data plus
// the angle at the end point for the arrowhead.
function bezier(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  // Curve mostly in the dominant axis so arrows feel like they "swing".
  const offset = Math.max(Math.abs(dx), Math.abs(dy)) * 0.35;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const c1 = horizontal ? { x: ax + offset, y: ay } : { x: ax, y: ay + offset };
  const c2 = horizontal ? { x: bx - offset, y: by } : { x: bx, y: by - offset };
  const path = `M${ax} ${ay} C${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${bx} ${by}`;
  // Approximate end-tangent from c2 -> b for the arrowhead.
  const angle = Math.atan2(by - c2.y, bx - c2.x);
  return { path, angle };
}

export default function ConnectionLayer({
  view, items, connections, pending, selectedConnectionId, onSelectConnection,
}: Props) {
  const byId = new Map(items.map((it) => [it.id, it]));

  function toScreen(wx: number, wy: number) {
    return { sx: wx * view.scale + view.x, sy: wy * view.scale + view.y };
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-[25]"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="#1A1510" />
        </marker>
        <marker
          id="arrowhead-amber"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="#D97435" />
        </marker>
      </defs>

      {connections.map((c) => {
        const a = byId.get(c.fromItemId);
        const b = byId.get(c.toItemId);
        if (!a || !b) return null;
        const ca = center(a);
        const cb = center(b);
        const sa = toScreen(ca.x, ca.y);
        const sb = toScreen(cb.x, cb.y);
        const { path } = bezier(sa.sx, sa.sy, sb.sx, sb.sy);
        const sel = c.id === selectedConnectionId;
        return (
          <g key={c.id} className="pointer-events-auto cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onSelectConnection(c.id); }}>
            {/* Wide invisible hit-target makes thin lines clickable. */}
            <path d={path} stroke="transparent" strokeWidth={14} fill="none" />
            <path
              d={path}
              stroke={sel ? '#D97435' : '#1A1510'}
              strokeOpacity={sel ? 1 : 0.55}
              strokeWidth={sel ? 2.2 : 1.6}
              fill="none"
              markerEnd={sel ? 'url(#arrowhead-amber)' : 'url(#arrowhead)'}
            />
          </g>
        );
      })}

      {pending && (() => {
        const from = byId.get(pending.fromItemId);
        if (!from) return null;
        const c = center(from);
        const s = toScreen(c.x, c.y);
        const { path } = bezier(s.sx, s.sy, pending.toScreenX, pending.toScreenY);
        return (
          <path
            d={path}
            stroke="#D97435"
            strokeOpacity={0.85}
            strokeWidth={2}
            fill="none"
            strokeDasharray="6 4"
            markerEnd="url(#arrowhead-amber)"
          />
        );
      })()}
    </svg>
  );
}
