import { PenIcon, HandIcon, EraserIcon, StylusIcon } from './icons';

export type Mode = 'drag' | 'pen' | 'erase';

const COLORS = ['#1b1b1b', '#d14b4b', '#2a6ed9', '#2fa865', '#d0a35a', '#9b59b6'];

interface Props {
  mode: Mode;
  color: string;
  width: number;
  penOnly: boolean;
  onMode: (m: Mode) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onPenOnly: (v: boolean) => void;
}

export default function DrawToolbar({
  mode, color, width, penOnly, onMode, onColor, onWidth, onPenOnly,
}: Props) {
  const palette = mode === 'pen' || mode === 'erase';

  return (
    <div className="absolute top-3 right-3 z-20 flex items-start gap-2">
      {palette && (
        <div className="bg-white/95 backdrop-blur rounded-lg shadow border border-black/10 px-2 py-2 flex items-center gap-2">
          {mode === 'pen' && (
            <>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => onColor(c)}
                  className="w-6 h-6 rounded-full border border-black/15"
                  style={{
                    background: c,
                    boxShadow: color === c ? '0 0 0 2px rgba(0,0,0,0.6)' : 'none',
                  }}
                  aria-label={`Ink ${c}`}
                />
              ))}
              <input
                type="range" min={1} max={10} value={width}
                onChange={(e) => onWidth(Number(e.target.value))}
                className="w-20"
                title="Stroke width"
              />
              <span className="w-px h-6 bg-black/10 mx-1" />
            </>
          )}

          <button
            onClick={() => onPenOnly(!penOnly)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
              penOnly ? 'bg-ink text-paper border-ink' : 'border-ink/20 hover:bg-ink/5'
            }`}
            title="When on, only Apple Pencil/stylus draws. Finger touches are ignored so your palm won't make marks."
          >
            <StylusIcon size={14} />
            <span>Pencil only</span>
          </button>
        </div>
      )}

      <div className="bg-white/95 backdrop-blur rounded-xl shadow border border-black/10 p-1 flex flex-col gap-1">
        <ModeButton
          active={mode === 'drag'}
          icon={<HandIcon size={20} />}
          label="Drag"
          onClick={() => onMode('drag')}
        />
        <ModeButton
          active={mode === 'pen'}
          icon={<PenIcon size={20} />}
          label="Pen"
          onClick={() => onMode('pen')}
        />
        <ModeButton
          active={mode === 'erase'}
          icon={<EraserIcon size={20} />}
          label="Erase"
          onClick={() => onMode('erase')}
        />
      </div>
    </div>
  );
}

function ModeButton({
  active, icon, label, onClick,
}: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg transition-colors ${
        active ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/5'
      }`}
      title={label}
    >
      {icon}
      <span className="text-[9px] mt-0.5 uppercase tracking-wider">{label}</span>
    </button>
  );
}
