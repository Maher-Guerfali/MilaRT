import { useRef, useState } from 'react';
import type { BaseItem } from '../types';

interface Props {
  items: BaseItem[];
  view: { x: number; y: number; scale: number };
  canvasSize: { w: number; h: number };
  onNavigate: (worldX: number, worldY: number) => void;
  onFocus?: () => void;
  canFocus?: boolean;
}

const MAP_PX = 140;
const MAP_PADDING = 10;
const ITEM_TYPE_COLOR: Record<string, string> = {
  sticky: '#E8B830',
  image:  '#9b6b3a',
  link:   '#2a6ed9',
  board:  '#D97435',
};

export default function MiniMap({ items, view, canvasSize, onNavigate, onFocus, canFocus }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

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

  // A click anywhere on the map jumps the camera to that point — no drag
  // required. Pointer move while pressed keeps panning.
  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = svgRef.current!.getBoundingClientRect();
    handleMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }
  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    handleMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }
  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  const v = project(visX, visY);
  const vw = visW * mapScale;
  const vh = visH * mapScale;

  return (
    <div
      className="absolute right-4 rounded-2xl border border-ink/10 overflow-hidden"
      style={{
        bottom: 64,
        width: MAP_PX,
        height: collapsed ? 28 : MAP_PX,
        zIndex: 180000,
        background: 'rgba(253,250,245,0.96)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 4px 18px rgba(26,21,16,0.10)',
        transition: 'height 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* Header bar — always visible, click to toggle */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setCollapsed(c => !c)}
        className="absolute top-0 left-0 right-0 h-7 flex items-center justify-between px-2 hover:bg-ink/5 transition-colors z-10"
        style={{ cursor: 'pointer' }}
      >
        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-ink/40">Map</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{
            transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s ease',
          }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink/40" />
        </svg>
      </button>

      {/* Map SVG — hidden when collapsed */}
      <div style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.2s ease', pointerEvents: collapsed ? 'none' : 'auto' }}>
        <svg
          ref={svgRef}
          width={MAP_PX}
          height={MAP_PX}
          viewBox={`0 0 ${MAP_PX} ${MAP_PX}`}
          style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
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
          {/* Current viewport — purely visual; clicks pass through to the svg. */}
          <rect
            x={v.x}
            y={v.y}
            width={vw}
            height={vh}
            fill="rgba(217,116,53,0.10)"
            stroke="#D97435"
            strokeWidth={1.5}
            rx={2}
            style={{ pointerEvents: 'none' }}
          />
        </svg>
        {onFocus && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onFocus(); }}
            disabled={!canFocus}
            title="Focus on selection (toggle zoom)"
            className="absolute bottom-1 right-1 w-[22px] h-[22px] rounded-md flex items-center justify-center transition-colors"
            style={{
              background: 'rgba(253,250,245,0.95)',
              border: '1px solid rgba(26,21,16,0.15)',
              color: canFocus ? '#1A1510' : 'rgba(26,21,16,0.25)',
              cursor: canFocus ? 'pointer' : 'default',
              boxShadow: '0 1px 4px rgba(26,21,16,0.10)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.5" />
              <path d="M12 3v3" />
              <path d="M12 18v3" />
              <path d="M3 12h3" />
              <path d="M18 12h3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
