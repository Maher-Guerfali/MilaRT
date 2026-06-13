import {
  useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import type { BaseItem, ItemType, MindEdge, MindMapCache, MindMapPosition } from '../types';
import { api } from '../api';
import { MindMapIcon, PlusIcon, MinusIcon, FitIcon, CloseIcon } from './icons';

interface Props {
  items: BaseItem[];
  boardId: string;
  position: MindMapPosition;
  onSetPosition: (p: MindMapPosition) => void;
  onClose: () => void;
  /** Fly the real board camera to this item (and select it). */
  onFocusItem: (id: string) => void;
}

// ── Graph model ──────────────────────────────────────────────────────────
interface GNode {
  id: string;
  type: ItemType;
  label: string;
  url?: string;       // image thumbnail
  color: string;
  r: number;          // radius in graph px
}
interface Sim { x: number; y: number; vx: number; vy: number }

// Per-type colour + base radius. Mirrors the canvas item palette.
const TYPE_STYLE: Record<string, { color: string; r: number }> = {
  sticky:   { color: '#E8B830', r: 17 },
  image:    { color: '#D97435', r: 23 },
  link:     { color: '#5B91D6', r: 15 },
  board:    { color: '#1A1510', r: 20 },
  document: { color: '#4Fae72', r: 16 },
};

// ── Physics tunables (tuned for an Obsidian-like springy settle) ──────────
const REPULSION = 9000;     // node↔node push
const SPRING = 0.035;       // edge pull strength
const LINK_LEN = 116;       // desired edge length
const GRAVITY = 0.018;      // pull toward centre (keeps graph on-screen)
const DAMPING = 0.86;       // velocity decay per tick
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.02;
const V_MAX = 45;           // velocity clamp — prevents blow-ups

const cacheKey = (boardId: string) => `milart.mindmap.${boardId}`;

function loadCache(boardId: string): MindMapCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(boardId));
    return raw ? (JSON.parse(raw) as MindMapCache) : null;
  } catch { return null; }
}
function saveCache(boardId: string, cache: MindMapCache) {
  try { localStorage.setItem(cacheKey(boardId), JSON.stringify(cache)); } catch { /* ignore */ }
}

function labelFor(it: BaseItem): string {
  const d = it.data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  switch (it.type) {
    case 'sticky':   return s(d.text) || 'Note';
    case 'link':     return s(d.title) || s(d.url) || 'Text';
    case 'image':    return s(d.caption) || 'Image';
    case 'board':    return s(d.name) || 'Board';
    case 'document': return s(d.title) || 'Document';
    default:         return 'Item';
  }
}

function truncate(s: string, n = 22): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

export default function MindMap({
  items, boardId, position, onSetPosition, onClose, onFocusItem,
}: Props) {
  // Nodes mirror items 1:1. Empty placeholder images (no url) still show as
  // nodes so nothing on the board is invisible in the map.
  const nodes = useMemo<GNode[]>(() => items.map((it) => {
    const st = TYPE_STYLE[it.type] ?? { color: '#8a8278', r: 16 };
    const url = it.type === 'image' ? ((it.data as { url?: string }).url || undefined) : undefined;
    return { id: it.id, type: it.type, label: labelFor(it), url, color: st.color, r: st.r };
  }), [items]);

  const itemsById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  // ── Container size ──────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The rAF loop is memoized once, so it must read size through a ref to
  // stay current as the panel resizes.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  // ── Physics state (mutated in the rAF loop) ─────────────────────────
  const simRef = useRef<Map<string, Sim>>(new Map());
  const nodesRef = useRef<GNode[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<MindEdge[]>([]);
  const alphaRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [, tick] = useReducer((x: number) => x + 1, 0);

  // ── Graph state ─────────────────────────────────────────────────────
  const [edges, setEdges] = useState<MindEdge[]>([]);
  const [summary, setSummary] = useState('');
  const [linking, setLinking] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  edgesRef.current = edges;

  // Seed physics positions from the items' real board layout (scaled to fit),
  // or from the cached settled positions when available.
  const seedPositions = useCallback((cache?: MindMapCache | null) => {
    const W = size.w || 800, H = size.h || 600;
    const sim = new Map<string, Sim>();
    // bbox of items on the real board
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + it.h);
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const fit = Math.min((W * 0.62) / bw, (H * 0.62) / bh);
    const bcx = minX + bw / 2, bcy = minY + bh / 2;
    for (const n of nodes) {
      const cached = cache?.positions?.[n.id];
      if (cached) { sim.set(n.id, { x: cached.x, y: cached.y, vx: 0, vy: 0 }); continue; }
      const it = itemsById.get(n.id);
      const jitter = () => (Math.random() - 0.5) * 24;
      const x = it ? W / 2 + (it.x + it.w / 2 - bcx) * fit + jitter() : W / 2 + jitter();
      const y = it ? H / 2 + (it.y + it.h / 2 - bcy) * fit + jitter() : H / 2 + jitter();
      sim.set(n.id, { x, y, vx: 0, vy: 0 });
    }
    simRef.current = sim;
  }, [items, nodes, itemsById, size.w, size.h]);

  // ── Simulation loop ─────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const stepFn = () => {
      step();
      tick();
      if (alphaRef.current > ALPHA_MIN || dragRef.current) {
        rafRef.current = requestAnimationFrame(stepFn);
      } else {
        runningRef.current = false;
        rafRef.current = null;
        persistPositions();
      }
    };
    rafRef.current = requestAnimationFrame(stepFn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reheat = useCallback((a = 0.85) => {
    alphaRef.current = Math.max(alphaRef.current, a);
    if (!runningRef.current) startLoop();
  }, [startLoop]);

  function step() {
    const sim = simRef.current;
    const ns = nodesRef.current;
    const W = sizeRef.current.w || 800, H = sizeRef.current.h || 600;
    const cx = W / 2, cy = H / 2;
    const alpha = alphaRef.current;

    // Repulsion (all pairs — fine for boards up to a few hundred items).
    for (let i = 0; i < ns.length; i++) {
      const a = sim.get(ns[i].id); if (!a) continue;
      for (let j = i + 1; j < ns.length; j++) {
        const b = sim.get(ns[j].id); if (!b) continue;
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 0.01; }
        const dist = Math.sqrt(d2);
        const rep = (REPULSION / d2) * alpha;
        const ux = dx / dist, uy = dy / dist;
        a.vx += ux * rep; a.vy += uy * rep;
        b.vx -= ux * rep; b.vy -= uy * rep;
      }
    }
    // Springs along edges.
    for (const e of edgesRef.current) {
      const a = sim.get(e.source), b = sim.get(e.target);
      if (!a || !b) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 1;
      const f = (dist - LINK_LEN) * SPRING * alpha;
      const ux = dx / dist, uy = dy / dist;
      a.vx -= ux * f; a.vy -= uy * f;
      b.vx += ux * f; b.vy += uy * f;
    }
    // Gravity + integration.
    for (const n of ns) {
      const p = sim.get(n.id); if (!p) continue;
      if (dragRef.current?.id === n.id) { p.vx = 0; p.vy = 0; continue; }
      p.vx += (cx - p.x) * GRAVITY * alpha;
      p.vy += (cy - p.y) * GRAVITY * alpha;
      p.vx *= DAMPING; p.vy *= DAMPING;
      p.vx = Math.max(-V_MAX, Math.min(V_MAX, p.vx));
      p.vy = Math.max(-V_MAX, Math.min(V_MAX, p.vy));
      p.x += p.vx; p.y += p.vy;
    }
    alphaRef.current = alpha * ALPHA_DECAY;
  }

  function persistPositions() {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of simRef.current) positions[id] = { x: p.x, y: p.y };
    const prev = loadCache(boardId) || { edges: edgesRef.current };
    saveCache(boardId, { ...prev, edges: edgesRef.current, positions, updatedAt: new Date().toISOString() });
  }

  // ── Edge generation (AI, with proximity fallback) ───────────────────
  const proximityEdges = useCallback((): MindEdge[] => {
    const out: MindEdge[] = [];
    const seen = new Set<string>();
    const sim = simRef.current;
    for (const a of nodes) {
      const pa = sim.get(a.id); if (!pa) continue;
      let best: string | null = null, bestD = Infinity;
      for (const b of nodes) {
        if (a.id === b.id) continue;
        const pb = sim.get(b.id); if (!pb) continue;
        const d = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
        if (d < bestD) { bestD = d; best = b.id; }
      }
      if (best) {
        const key = a.id < best ? `${a.id}|${best}` : `${best}|${a.id}`;
        if (!seen.has(key)) { seen.add(key); out.push({ source: a.id, target: best, label: 'near' }); }
      }
    }
    return out;
  }, [nodes]);

  const generateLinks = useCallback(async () => {
    if (nodes.length < 2) { setEdges([]); return; }
    setLinking(true);
    try {
      const payload = nodes.map((n) => ({ id: n.id, type: n.type, label: n.label }));
      const { edges: aiEdges, summary: s } = await api.mindmapLinks(payload);
      const next = aiEdges.length ? aiEdges : proximityEdges();
      setEdges(next);
      setSummary(s);
      saveCache(boardId, { edges: next, signature: signatureOf(nodes), updatedAt: new Date().toISOString() });
    } catch {
      // AI unavailable — fall back to a proximity graph so the map still works.
      const next = proximityEdges();
      setEdges(next);
      setSummary('');
      saveCache(boardId, { edges: next, signature: signatureOf(nodes), updatedAt: new Date().toISOString() });
    } finally {
      setLinking(false);
      reheat();
    }
  }, [nodes, proximityEdges, boardId, reheat]);

  // ── Init: seed positions, load/generate edges, start the sim ────────
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || size.w === 0) return;
    initedRef.current = true;
    const cache = loadCache(boardId);
    seedPositions(cache);
    const sig = signatureOf(nodes);
    if (cache?.edges && cache.signature === sig) {
      setEdges(cache.edges);
    } else {
      void generateLinks();
    }
    reheat(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w]);

  // Keep the physics map in sync when items are added/removed while open.
  useEffect(() => {
    if (!initedRef.current) return;
    const sim = simRef.current;
    let changed = false;
    const W = size.w || 800, H = size.h || 600;
    for (const n of nodes) {
      if (!sim.has(n.id)) {
        sim.set(n.id, { x: W / 2 + (Math.random() - 0.5) * 80, y: H / 2 + (Math.random() - 0.5) * 80, vx: 0, vy: 0 });
        changed = true;
      }
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of [...sim.keys()]) if (!ids.has(id)) { sim.delete(id); changed = true; }
    if (changed) reheat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // Stop the loop + persist on unmount.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    runningRef.current = false;
    persistPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pointer interaction (drag nodes, pan, zoom) ─────────────────────
  function toGraph(clientX: number, clientY: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }

  const panRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);

  function onNodeDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { id, moved: false };
    reheat(0.5);
  }
  function onSvgDown(e: React.PointerEvent) {
    if (dragRef.current) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    panRef.current = { px: e.clientX, py: e.clientY, tx: view.tx, ty: view.ty };
  }
  function onSvgMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag) {
      const p = toGraph(e.clientX, e.clientY);
      const s = simRef.current.get(drag.id);
      if (s) { s.x = p.x; s.y = p.y; s.vx = 0; s.vy = 0; }
      drag.moved = true;
      reheat(0.4);
      return;
    }
    const pan = panRef.current;
    if (pan) setView((v) => ({ ...v, tx: pan.tx + (e.clientX - pan.px), ty: pan.ty + (e.clientY - pan.py) }));
  }
  function onSvgUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag) {
      // A press without movement = click → focus the item on the board.
      if (!drag.moved) onFocusItem(drag.id);
      dragRef.current = null;
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      reheat(0.2);
      return;
    }
    panRef.current = null;
  }

  // Wheel zoom around the cursor.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-ev.deltaY * 0.0016);
        const scale = Math.max(0.25, Math.min(3, v.scale * factor));
        const gx = (mx - v.tx) / v.scale, gy = (my - v.ty) / v.scale;
        return { scale, tx: mx - gx * scale, ty: my - gy * scale };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function fitView() {
    const sim = simRef.current;
    if (sim.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of sim.values()) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const W = size.w, H = size.h, pad = 70;
    const gw = Math.max(1, maxX - minX), gh = Math.max(1, maxY - minY);
    const scale = Math.max(0.25, Math.min(2, Math.min((W - pad * 2) / gw, (H - pad * 2) / gh)));
    const gcx = (minX + maxX) / 2, gcy = (minY + maxY) / 2;
    setView({ scale, tx: W / 2 - gcx * scale, ty: H / 2 - gcy * scale });
  }

  // Neighbour set for hover highlighting.
  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of edges) {
      if (e.source === hover) set.add(e.target);
      if (e.target === hover) set.add(e.source);
    }
    return set;
  }, [hover, edges]);

  const sim = simRef.current;
  const dim = (id: string) => (neighbours ? (neighbours.has(id) ? 1 : 0.18) : 1);

  return (
    <div
      className="absolute inset-0 flex flex-col animate-fadeIn"
      style={{ background: 'rgba(243,237,224,0.97)', backdropFilter: 'blur(3px)' }}
    >
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-ink/10"
        style={{ background: 'rgba(253,250,245,0.9)' }}>
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
          <span className="text-amber"><MindMapIcon size={16} /></span>
          Mind Map
        </span>
        <span className="text-[11px] text-ink/45">{nodes.length} nodes · {edges.length} links</span>
        {summary && (
          <span className="hidden md:block text-[11px] text-ink/55 italic truncate max-w-[34ch]" title={summary}>
            “{summary}”
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={generateLinks}
            disabled={linking || nodes.length < 2}
            className="h-7 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all disabled:opacity-40"
            style={{ background: '#D97435', color: 'white' }}
            title="Re-analyse the board and rebuild links with AI"
          >
            <span className={linking ? 'animate-pulse' : ''}>✦</span>
            {linking ? 'Linking…' : 'Re-link'}
          </button>

          {/* Position switcher */}
          <div className="flex items-center rounded-lg border border-ink/10 overflow-hidden" style={{ background: 'rgba(253,250,245,0.9)' }}>
            {(['left', 'full', 'right'] as MindMapPosition[]).map((p) => (
              <button
                key={p}
                onClick={() => onSetPosition(p)}
                title={`Dock ${p}`}
                className={`w-7 h-7 flex items-center justify-center transition-colors ${
                  position === p ? 'bg-ink text-paper' : 'text-ink/50 hover:bg-ink/10'
                }`}
              >
                <PositionGlyph pos={p} />
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            title="Hide mind map"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/55 hover:bg-ink/10 transition-colors"
          ><CloseIcon size={15} /></button>
        </div>
      </div>

      {/* Graph surface */}
      <div ref={wrapRef} className="relative flex-1 overflow-hidden" style={{ touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'grab' }}>
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink/45">
            <MindMapIcon size={34} />
            <span className="text-[13px]">This board is empty — add notes, images or boards to see them mapped.</span>
          </div>
        ) : (
          <svg
            className="absolute inset-0 w-full h-full"
            onPointerDown={onSvgDown}
            onPointerMove={onSvgMove}
            onPointerUp={onSvgUp}
            onPointerCancel={onSvgUp}
          >
            <defs>
              {nodes.filter((n) => n.url).map((n) => (
                <clipPath key={`clip-${n.id}`} id={`mm-clip-${n.id}`}>
                  <circle cx={0} cy={0} r={n.r} />
                </clipPath>
              ))}
            </defs>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
              {/* Edges */}
              {edges.map((e, i) => {
                const a = sim.get(e.source), b = sim.get(e.target);
                if (!a || !b) return null;
                const active = neighbours ? (neighbours.has(e.source) && neighbours.has(e.target)) : false;
                const showLabel = !!e.label && (hover === e.source || hover === e.target);
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                return (
                  <g key={`e-${i}`} style={{ opacity: neighbours ? (active ? 0.95 : 0.12) : 0.5, transition: 'opacity 0.15s' }}>
                    <line
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={active ? '#D97435' : '#1A1510'}
                      strokeWidth={active ? 2 : 1.1}
                      strokeOpacity={active ? 0.8 : 0.32}
                    />
                    {showLabel && (
                      <text
                        x={mx} y={my} textAnchor="middle"
                        fontSize={9} fill="#7a6f60"
                        style={{ paintOrder: 'stroke', stroke: '#F3EDE0', strokeWidth: 3 }}
                      >{e.label}</text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((n) => {
                const p = sim.get(n.id);
                if (!p) return null;
                const isHover = hover === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ opacity: dim(n.id), transition: 'opacity 0.15s', cursor: 'pointer' }}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onPointerEnter={() => setHover(n.id)}
                    onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  >
                    {/* halo on hover */}
                    {isHover && (
                      <circle r={n.r + 6} fill="none" stroke="#D97435" strokeWidth={2} strokeOpacity={0.5} />
                    )}
                    {n.url ? (
                      <>
                        <image
                          href={n.url}
                          x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2}
                          clipPath={`url(#mm-clip-${n.id})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                        <circle r={n.r} fill="none" stroke={n.color} strokeWidth={2.5} />
                      </>
                    ) : (
                      <circle
                        r={n.r}
                        fill={n.color}
                        stroke="#FDFAF5"
                        strokeWidth={2}
                        fillOpacity={n.type === 'board' ? 0.92 : 0.85}
                      />
                    )}
                    <text
                      y={n.r + 12} textAnchor="middle"
                      fontSize={11} fontWeight={600} fill="#1A1510"
                      style={{ paintOrder: 'stroke', stroke: '#F3EDE0', strokeWidth: 3.5, pointerEvents: 'none' }}
                    >{truncate(n.label)}</text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Hint */}
        <div className="absolute bottom-3 left-3 text-[10.5px] text-ink/40 pointer-events-none select-none">
          Drag nodes · scroll to zoom · click a node to find it on the board
        </div>

        {/* Zoom controls (mirror the canvas dock) */}
        <div
          className="absolute bottom-3 right-3 rounded-[13px] border border-ink/10 flex items-center p-1 gap-px"
          style={{ background: 'rgba(253,250,245,0.96)', boxShadow: '0 4px 18px rgba(26,21,16,0.09)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => setView((v) => ({ ...v, scale: Math.max(0.25, v.scale / 1.3) }))}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/50 hover:bg-ink/10" title="Zoom out">
            <MinusIcon size={14} />
          </button>
          <button onClick={fitView}
            className="px-2.5 h-7 rounded-lg flex items-center gap-1 text-ink/50 hover:bg-ink/10 text-[12px] font-bold" title="Fit to view">
            <FitIcon size={12} />
          </button>
          <button onClick={() => setView((v) => ({ ...v, scale: Math.min(3, v.scale * 1.3) }))}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink/50 hover:bg-ink/10" title="Zoom in">
            <PlusIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Item-set signature — when it changes we know to regenerate AI links.
function signatureOf(nodes: GNode[]): string {
  return nodes.map((n) => n.id).sort().join(',');
}

// Little dock-position glyphs for the position switcher.
function PositionGlyph({ pos }: { pos: MindMapPosition }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {pos === 'left' && <rect x="3" y="4" width="8" height="16" rx="2" fill="currentColor" stroke="none" />}
      {pos === 'right' && <rect x="13" y="4" width="8" height="16" rx="2" fill="currentColor" stroke="none" />}
      {pos === 'full' && <rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" stroke="none" />}
    </svg>
  );
}
