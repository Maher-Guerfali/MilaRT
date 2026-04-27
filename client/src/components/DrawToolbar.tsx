import { PenIcon, HandIcon, EraserIcon } from './icons';

const COLORS = ['#1b1b1b', '#d14b4b', '#2a6ed9', '#2fa865', '#d0a35a', '#9b59b6'];

interface Props {
  drawMode: boolean;
  color: string;
  width: number;
  eraser: boolean;
  onToggle: () => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onEraser: () => void;
  onClear: () => void;
}

export default function DrawToolbar({
  drawMode, color, width, eraser, onToggle, onColor, onWidth, onEraser, onClear,
}: Props) {
  return (
    <div className="absolute top-3 right-3 z-20 flex items-start gap-2">
      {drawMode && (
        <div className="bg-white/95 backdrop-blur rounded-lg shadow border border-black/10 px-2 py-2 flex items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColor(c)}
              className="w-6 h-6 rounded-full border border-black/15"
              style={{
                background: c,
                boxShadow: !eraser && color === c ? '0 0 0 2px rgba(0,0,0,0.6)' : 'none',
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
          <button
            onClick={onEraser}
            className={`w-8 h-8 rounded-md flex items-center justify-center border ${eraser ? 'bg-ink text-paper border-ink' : 'border-ink/20 hover:bg-ink/5'}`}
            title="Eraser"
          ><EraserIcon size={16} /></button>
          <button
            onClick={onClear}
            className="text-xs px-2 py-1 rounded-md border border-ink/20 hover:bg-ink/5"
            title="Clear all strokes"
          >Clear</button>
        </div>
      )}

      <button
        onClick={onToggle}
        className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl shadow border ${drawMode ? 'bg-ink text-paper border-ink' : 'bg-white text-ink border-black/10 hover:border-ink/40'}`}
        title={drawMode ? 'Switch to drag mode' : 'Switch to draw mode'}
      >
        {drawMode ? <HandIcon size={22} /> : <PenIcon size={22} />}
        <span className="text-[10px] mt-0.5 uppercase tracking-wider">
          {drawMode ? 'Drag' : 'Draw'}
        </span>
      </button>
    </div>
  );
}
