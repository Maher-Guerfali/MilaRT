import { useRef, useState } from 'react';

export type DrawTool = 'pencil' | 'eraser' | 'select';
export type SizeKey  = 'sm' | 'md' | 'lg';

interface Props {
  open: boolean;
  drawTool: DrawTool;
  penColor: string;
  penSize: SizeKey;
  eraserSize: SizeKey;
  penOnly: boolean;
  onToolChange: (t: DrawTool) => void;
  onColorChange: (c: string) => void;
  onPenSizeChange: (s: SizeKey) => void;
  onEraserSizeChange: (s: SizeKey) => void;
  onPenOnlyChange: (v: boolean) => void;
  onClose: () => void;
}

const PRESETS = ['#1a1510', '#D97435', '#E8B830', '#2a9d8f', '#e76f51', '#8b5cf6'];

export default function DrawTray(props: Props) {
  if (!props.open) return null;

  const { drawTool, penOnly } = props;
  const activeSize = drawTool === 'eraser' ? props.eraserSize : props.penSize;
  const setActiveSize = drawTool === 'eraser' ? props.onEraserSizeChange : props.onPenSizeChange;

  const colorsDisabled = drawTool === 'eraser' || drawTool === 'select';
  const sizeDisabled   = drawTool === 'select';

  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none"
      style={{ zIndex: 180000 }}
    >
      <div
        className="pointer-events-auto relative animate-trayUp"
        style={{
          background: 'rgba(253,250,245,0.97)',
          backdropFilter: 'blur(18px)',
          borderRadius: '18px 18px 0 0',
          border: '1px solid rgba(26,21,16,0.10)',
          borderBottom: 'none',
          boxShadow: '0 -6px 32px rgba(26,21,16,0.12)',
          width: '100%',
          maxWidth: 520,
          padding: '8px 22px 16px',
        }}
      >
        {/* Drag handle indicator */}
        <div className="flex justify-center mb-2">
          <div className="w-8 h-1 rounded-full bg-ink/10" />
        </div>

        <div className="flex items-center gap-0">
          {/* Tool illustrations */}
          <div className="flex gap-[2px] items-end">
            <ToolBtn active={drawTool === 'pencil'} onClick={() => props.onToolChange('pencil')}>
              <PencilArt active={drawTool === 'pencil'} />
            </ToolBtn>
            <ToolBtn active={drawTool === 'eraser'} onClick={() => props.onToolChange('eraser')}>
              <EraserArt active={drawTool === 'eraser'} />
            </ToolBtn>
            <ToolBtn active={drawTool === 'select'} onClick={() => props.onToolChange('select')}>
              <SelectArt active={drawTool === 'select'} />
            </ToolBtn>
          </div>

          <Divider />

          {/* Colors — always visible, dimmed when irrelevant */}
          <div
            className="flex flex-col gap-[5px] transition-opacity"
            style={{
              opacity: colorsDisabled ? 0.35 : 1,
              pointerEvents: colorsDisabled ? 'none' : 'auto',
            }}
          >
            <div className="flex gap-[5px]">
              {PRESETS.slice(0, 3).map((c) => (
                <ColorDot key={c} color={c} active={props.penColor === c} onClick={() => props.onColorChange(c)} />
              ))}
            </div>
            <div className="flex gap-[5px]">
              {PRESETS.slice(3).map((c) => (
                <ColorDot key={c} color={c} active={props.penColor === c} onClick={() => props.onColorChange(c)} />
              ))}
              <CustomColor value={props.penColor} onChange={props.onColorChange} />
            </div>
          </div>

          <Divider />

          {/* Size column — always visible, dimmed for select */}
          <div
            className="flex flex-col items-center gap-[6px] transition-opacity"
            style={{
              opacity: sizeDisabled ? 0.3 : 1,
              pointerEvents: sizeDisabled ? 'none' : 'auto',
            }}
          >
            <span className="text-[9px] font-bold text-ink/50 uppercase tracking-[0.1em] leading-none">Size</span>
            {([['sm', 7], ['md', 11], ['lg', 16]] as const).map(([k, d]) => (
              <button
                key={k}
                onClick={() => setActiveSize(k)}
                className="rounded-full border-0 cursor-pointer flex-shrink-0 transition-all"
                style={{
                  width: d, height: d,
                  background: activeSize === k ? '#D97435' : 'rgba(26,21,16,0.18)',
                  boxShadow: activeSize === k ? '0 0 0 3px rgba(217,116,53,0.25)' : 'none',
                }}
              />
            ))}
          </div>

          {drawTool === 'select' && (
            <>
              <Divider mx={[14, 10]} />
              <div className="flex items-center">
                <span className="text-[11px] text-ink/50 font-medium leading-tight max-w-[160px]">
                  Draw around<br/>items to select
                </span>
              </div>
            </>
          )}

          {/* "Only pencil" (palm rejection) pill — far right */}
          <Divider mx={[14, 10]} />
          <button
            onClick={() => props.onPenOnlyChange(!penOnly)}
            title={penOnly ? 'Apple Pencil only — touch ignored' : 'Tap to enable Apple Pencil / stylus-only mode'}
            className="flex-shrink-0 px-3 py-[6px] rounded-full border text-[11px] font-semibold transition-all cursor-pointer"
            style={{
              background: penOnly ? '#D97435' : 'transparent',
              color: penOnly ? '#fff' : 'rgba(26,21,16,0.35)',
              borderColor: penOnly ? '#D97435' : 'rgba(26,21,16,0.18)',
              boxShadow: penOnly ? '0 0 0 3px rgba(217,116,53,0.22)' : 'none',
            }}
          >Only pencil</button>
        </div>

        {/* Close */}
        <button
          onClick={props.onClose}
          className="absolute top-2.5 right-3.5 w-[26px] h-[26px] rounded-lg border-0 cursor-pointer bg-transparent text-ink/50 text-lg flex items-center justify-center transition-colors hover:bg-ink/10"
        >×</button>
      </div>
    </div>
  );
}

function Divider({ mx = [14, 14] }: { mx?: [number, number] }) {
  return <div className="w-px h-12 bg-ink/10 flex-shrink-0" style={{ marginLeft: mx[0], marginRight: mx[1] }} />;
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="flex flex-col items-center gap-[5px] px-2.5 pt-1 pb-1.5 rounded-xl border-0 cursor-pointer transition-colors"
      style={{
        background: active ? 'rgba(217,116,53,0.09)' : (hov ? 'rgba(26,21,16,0.04)' : 'transparent'),
      }}
    >
      {children}
      <div
        className="rounded-full transition-all"
        style={{
          width: active ? 18 : 6,
          height: 3,
          background: active ? '#D97435' : 'rgba(26,21,16,0.10)',
        }}
      />
    </button>
  );
}

function ColorDot({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border-0 cursor-pointer flex-shrink-0 transition-all"
      style={{
        width: 22, height: 22,
        background: color,
        boxShadow: active ? `0 0 0 2px white, 0 0 0 4px ${color}` : '0 1px 3px rgba(0,0,0,0.18)',
        transform: active ? 'scale(1.18)' : 'scale(1)',
      }}
    />
  );
}

function CustomColor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const isCustom = !PRESETS.includes(value);
  return (
    <button
      onClick={() => ref.current?.click()}
      className="relative rounded-full cursor-pointer flex-shrink-0 flex items-center justify-center transition-all"
      style={{
        width: 22, height: 22,
        border: '2px dashed rgba(26,21,16,0.10)',
        background: isCustom ? value : '#FDFAF5',
        boxShadow: isCustom ? `0 0 0 2px white, 0 0 0 4px ${value}` : 'none',
      }}
    >
      {!isCustom && <span className="text-sm text-ink/50 leading-none">+</span>}
      <input
        ref={ref}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />
    </button>
  );
}

/* ── Paper 53-style illustrated tool icons ──────────────────── */

function PencilArt({ active }: { active: boolean }) {
  const gold   = active ? '#F5C030' : '#CACACA';
  const dark   = active ? '#C8920A' : '#ABABAB';
  const metal  = active ? '#B8C4D0' : '#CFCFCF';
  const eraser = active ? '#FFB3BA' : '#D8D8D8';
  const tip    = active ? '#333'    : '#AAAAAA';
  return (
    <svg width="18" height="44" viewBox="0 0 18 44"
      style={{ filter: active ? 'drop-shadow(0 2px 6px rgba(217,116,53,0.45))' : 'none', transition: 'filter 0.18s' }}>
      <rect x="3" y="1"  width="12" height="5"  rx="2.5" fill={eraser}/>
      <rect x="3" y="5.5" width="12" height="3" fill={metal} rx="0.5"/>
      <rect x="3" y="8"  width="12" height="22" fill={gold}  rx="0.5"/>
      <polygon points="3,30 15,30 9,41" fill={dark}/>
      <polygon points="7,38 11,38 9,42" fill={tip}/>
    </svg>
  );
}

function EraserArt({ active }: { active: boolean }) {
  const body   = active ? '#FF9BA5' : '#D4D4D4';
  const stripe = active ? '#FFD4D8' : '#E4E4E4';
  return (
    <svg width="30" height="44" viewBox="0 0 30 44"
      style={{ filter: active ? 'drop-shadow(0 2px 6px rgba(217,116,53,0.45))' : 'none', transition: 'filter 0.18s' }}>
      <rect x="2" y="9"  width="26" height="22" rx="4" fill={body}/>
      <rect x="2" y="9"  width="26" height="8"  rx="4" fill={stripe}/>
      <rect x="2" y="28" width="26" height="3"  rx="1.5" fill="rgba(0,0,0,0.07)"/>
    </svg>
  );
}

function SelectArt({ active }: { active: boolean }) {
  const clr = active ? '#D97435' : '#BBBBBB';
  return (
    <svg width="28" height="44" viewBox="0 0 28 44"
      style={{ filter: active ? 'drop-shadow(0 2px 6px rgba(217,116,53,0.45))' : 'none', transition: 'filter 0.18s' }}>
      <circle cx="8"  cy="12" r="4.5" fill="none" stroke={clr} strokeWidth="1.8"/>
      <circle cx="20" cy="12" r="4.5" fill="none" stroke={clr} strokeWidth="1.8"/>
      <line x1="12" y1="15.5" x2="21" y2="39" stroke={clr} strokeWidth="1.8" strokeLinecap="round"/>
      <line x1="16" y1="15.5" x2="7"  y2="39" stroke={clr} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

