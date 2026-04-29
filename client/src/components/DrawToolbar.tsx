import type { StrokeTool } from '../types';
import { HandIcon, StylusIcon } from './icons';

export type Mode = 'drag' | 'pen' | 'erase';

const COLORS = ['#1b1b1b', '#888888', '#9b6b3a', '#2fa865', '#7fc7d9', '#9b59b6', '#5a3a1b', '#d14b4b'];

// Each tool draws differently — see StrokeLayer for the rendering rules.
// Visuals mimic Paper's tool dock: a barrel + tip, color-tinted by current ink.
const TOOLS: { id: StrokeTool; label: string; tipWidth: number; widthRange: [number, number] }[] = [
  { id: 'pen',      label: 'Pen',       tipWidth: 2, widthRange: [1, 3] },
  { id: 'fountain', label: 'Fountain',  tipWidth: 2, widthRange: [1, 5] },
  { id: 'pencil',   label: 'Pencil',    tipWidth: 1.5, widthRange: [1, 2] },
  { id: 'marker',   label: 'Marker',    tipWidth: 6, widthRange: [4, 10] },
  { id: 'brush',    label: 'Brush',     tipWidth: 4, widthRange: [2, 8] },
];

interface Props {
  mode: Mode;
  color: string;
  width: number;
  tool: StrokeTool;
  penOnly: boolean;
  onMode: (m: Mode) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onTool: (t: StrokeTool) => void;
  onPenOnly: (v: boolean) => void;
}

export default function DrawToolbar({
  mode, color, width, tool, penOnly,
  onMode, onColor, onWidth, onTool, onPenOnly,
}: Props) {
  const visible = mode !== 'drag';

  return (
    <>
      {/* Always-on hand button — top-right corner. Toggles in/out of draw mode. */}
      <div className="absolute top-3 right-3 z-30">
        <button
          onClick={() => onMode(mode === 'drag' ? 'pen' : 'drag')}
          className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl shadow border ${
            mode === 'drag' ? 'bg-white text-ink border-black/10' : 'bg-ink text-paper border-ink'
          }`}
          title={mode === 'drag' ? 'Switch to pen' : 'Switch to drag'}
        >
          {mode === 'drag' ? <StylusIcon size={20} /> : <HandIcon size={20} />}
          <span className="text-[9px] mt-0.5 uppercase tracking-wider">
            {mode === 'drag' ? 'Pen' : 'Drag'}
          </span>
        </button>
      </div>

      {/* Paper-style dock — only when in pen/erase. Centered along the bottom. */}
      {visible && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 select-none">
          <div className="flex items-stretch gap-3 bg-zinc-900/95 backdrop-blur rounded-2xl shadow-2xl px-3 py-2 border border-white/5">
            {/* Tools */}
            <div className="flex items-end gap-1">
              {TOOLS.map((t) => {
                const active = mode === 'pen' && tool === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      onTool(t.id);
                      if (mode !== 'pen') onMode('pen');
                    }}
                    title={t.label}
                    className={`relative flex flex-col items-center justify-end px-1 transition-all ${
                      active ? '-translate-y-2' : 'opacity-80 hover:opacity-100 hover:-translate-y-1'
                    }`}
                  >
                    <ToolPenIcon tool={t.id} color={color} />
                  </button>
                );
              })}
            </div>

            {/* Eraser */}
            <button
              onClick={() => onMode('erase')}
              title="Eraser"
              className={`flex items-end px-1 transition-all ${
                mode === 'erase' ? '-translate-y-2' : 'opacity-80 hover:opacity-100 hover:-translate-y-1'
              }`}
            >
              <EraserPenIcon />
            </button>

            {/* Stroke width slider — only in pen mode */}
            {mode === 'pen' && (
              <div className="flex items-center pl-2 pr-2 border-l border-white/10">
                <input
                  type="range"
                  min={TOOLS.find((t) => t.id === tool)!.widthRange[0]}
                  max={TOOLS.find((t) => t.id === tool)!.widthRange[1]}
                  step={0.5}
                  value={width}
                  onChange={(e) => onWidth(Number(e.target.value))}
                  className="w-20 accent-white"
                  title="Stroke width"
                />
              </div>
            )}

            {/* Color palette */}
            {mode === 'pen' && (
              <div className="flex items-center gap-1 pl-2 border-l border-white/10">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onColor(c)}
                    className="w-6 h-6 rounded-full border border-white/30"
                    style={{
                      background: c,
                      boxShadow: color === c ? '0 0 0 2px white' : 'none',
                    }}
                    aria-label={`Ink ${c}`}
                  />
                ))}
              </div>
            )}

            {/* Pencil-only toggle */}
            <button
              onClick={() => onPenOnly(!penOnly)}
              title={penOnly ? 'Pencil-only is ON — finger touches ignored' : 'Pencil-only is OFF — finger draws too'}
              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md self-center border ${
                penOnly ? 'bg-white text-ink border-white' : 'text-white/80 border-white/20 hover:border-white/50'
              }`}
            >
              <StylusIcon size={12} />
              <span>Pencil</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Stylized 2D pen icons — barrel tinted by current ink, tip in metal/black.
function ToolPenIcon({ tool, color }: { tool: StrokeTool; color: string }) {
  const barrel = barrelStyle(tool, color);
  return (
    <svg width="22" height="80" viewBox="0 0 22 80" className="block">
      {/* tip (metal cone) */}
      <path d="M11 0 L17 14 H5 Z" fill={tipColor(tool)} />
      {/* ferrule */}
      <rect x="4" y="14" width="14" height="3" fill="#8a8a8a" />
      {/* barrel */}
      <rect x="3" y="17" width="16" height="55" rx="2" fill={barrel.fill} stroke="#0008" strokeWidth="0.5" />
      {/* highlight */}
      <rect x="5" y="19" width="2" height="51" rx="1" fill="white" opacity="0.18" />
      {/* end cap */}
      <rect x="3" y="72" width="16" height="6" rx="1" fill={barrel.cap} />
    </svg>
  );
}

function EraserPenIcon() {
  return (
    <svg width="22" height="80" viewBox="0 0 22 80" className="block">
      <rect x="3" y="0" width="16" height="22" rx="3" fill="#f7c4a3" />
      <rect x="3" y="22" width="16" height="3" fill="#caa07a" />
      <rect x="3" y="25" width="16" height="50" rx="2" fill="#3b3b3b" stroke="#0008" strokeWidth="0.5" />
      <rect x="5" y="27" width="2" height="46" rx="1" fill="white" opacity="0.15" />
    </svg>
  );
}

function tipColor(tool: StrokeTool) {
  switch (tool) {
    case 'fountain': return '#d4af37';
    case 'pencil':   return '#1a1a1a';
    case 'marker':   return '#f1f1f1';
    case 'brush':    return '#7a5230';
    default:         return '#bfbfbf';
  }
}

function barrelStyle(tool: StrokeTool, color: string) {
  switch (tool) {
    case 'pen':      return { fill: '#5b5b5b', cap: '#2b2b2b' };
    case 'fountain': return { fill: '#1f2937', cap: '#0b0f17' };
    case 'pencil':   return { fill: '#c89a4a', cap: '#7d5a25' };
    case 'marker':   return { fill: color, cap: '#222' };
    case 'brush':    return { fill: '#9b6b3a', cap: '#5a3a1b' };
  }
}
