import { useEffect, useRef, useState } from 'react';
import type { Peer } from '../hooks/usePresence';

interface Props {
  peers: Peer[];
  view: { x: number; y: number; scale: number };
}

interface RenderedPeer {
  peer: Peer;
  /** Smoothed screen-space position (not world). */
  sx: number;
  sy: number;
}

const LERP = 0.25;          // 0=no smoothing, 1=instant snap
const HIDE_AFTER_MS = 8000; // hide cursors that stop sending

// Render remote cursors as an absolute overlay above the canvas. World →
// screen transform mirrors Canvas's `transform: translate scale`. Cursor
// glyphs themselves DON'T scale with zoom, so they stay the same size.
export default function PresenceLayer({ peers, view }: Props) {
  // Keep a smoothed render state separate from the raw stream so cursors
  // glide instead of jumping at low packet rates.
  const renderRef = useRef<Map<string, RenderedPeer>>(new Map());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const [, force] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Track the latest target screen position per peer (recomputed when peers
  // or view changes).
  const targets = new Map<string, { sx: number; sy: number }>();
  for (const p of peers) {
    if (p.x == null || p.y == null) continue;
    targets.set(p.id, {
      sx: p.x * view.scale + view.x,
      sy: p.y * view.scale + view.y,
    });
  }

  useEffect(() => {
    // Stamp last-seen for any peer whose cursor moved this render.
    const now = performance.now();
    for (const id of targets.keys()) lastSeenRef.current.set(id, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers]);

  useEffect(() => {
    function tick() {
      const map = renderRef.current;
      let changed = false;

      // Add / lerp every peer whose cursor we know.
      for (const peer of peers) {
        const t = targets.get(peer.id);
        if (!t) continue;
        const cur = map.get(peer.id);
        if (!cur) {
          map.set(peer.id, { peer, sx: t.sx, sy: t.sy });
          changed = true;
          continue;
        }
        const dx = t.sx - cur.sx;
        const dy = t.sy - cur.sy;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          cur.sx += dx * LERP;
          cur.sy += dy * LERP;
          cur.peer = peer;
          changed = true;
        } else if (cur.peer !== peer) {
          cur.peer = peer;
        }
      }

      // Drop peers we haven't seen in a while.
      const stale = performance.now() - HIDE_AFTER_MS;
      for (const id of Array.from(map.keys())) {
        if (!peers.find((p) => p.id === id)) {
          map.delete(id);
          changed = true;
          continue;
        }
        const seen = lastSeenRef.current.get(id) ?? 0;
        if (seen < stale) {
          map.delete(id);
          changed = true;
        }
      }

      if (changed) force((n) => (n + 1) & 0xffff);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, view.x, view.y, view.scale]);

  const rendered = Array.from(renderRef.current.values());

  return (
    <div className="absolute inset-0 pointer-events-none z-[150] overflow-hidden">
      {rendered.map(({ peer, sx, sy }) => (
        <div
          key={peer.id}
          className="absolute"
          style={{ transform: `translate(${sx}px, ${sy}px)` }}
        >
          <CursorGlyph color={peer.color} />
          <div
            className="absolute left-4 top-4 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold text-white whitespace-nowrap"
            style={{ background: peer.color, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}
          >
            {peer.name}
          </div>
        </div>
      ))}
    </div>
  );
}

// Classic Miro-style arrow cursor — stroked outline + coloured fill so it's
// visible on any background.
function CursorGlyph({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      style={{ display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.25))' }}
    >
      <path
        d="M5 3 L19 12 L12 13 L9 20 Z"
        fill={color}
        stroke="white"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
