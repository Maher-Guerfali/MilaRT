import { useState, type ComponentType } from 'react';
import { HandIcon, PenIcon, UndoIcon, RedoIcon } from './icons';
import Tooltip from './Tooltip';

interface Props {
  isMove: boolean;
  drawOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onMove: () => void;
  onDraw: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface DockBtnProps {
  Icon: ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function DockBtn({ Icon, label, active, disabled, onClick }: DockBtnProps) {
  const [hov, setHov] = useState(false);
  return (
    <Tooltip label={label} side="right">
      <button
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        className="rounded-xl border-0 flex flex-col items-center justify-center gap-[3px] text-[8.5px] font-bold uppercase tracking-[0.06em] transition-all"
        style={{
          width: 46, height: 42,
          cursor: disabled ? 'default' : 'pointer',
          background: active
            ? 'linear-gradient(135deg, #D97435, #F08848)'
            : (hov && !disabled ? 'rgba(26,21,16,0.10)' : 'transparent'),
          color: active ? '#fff' : disabled ? 'rgba(26,21,16,0.20)' : (hov ? '#1A1510' : 'rgba(26,21,16,0.50)'),
          boxShadow: active ? '0 2px 12px rgba(217,116,53,0.40)' : 'none',
        }}
      >
        <Icon size={17} />
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

export default function CanvasDock({
  isMove, drawOpen, canUndo, canRedo, onMove, onDraw, onUndo, onRedo,
}: Props) {
  return (
    <div
      className="absolute top-[14px] right-[16px] z-20 rounded-2xl border border-ink/10 p-[5px] flex flex-col gap-[2px]"
      style={{
        background: 'rgba(253,250,245,0.95)',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 4px 20px rgba(26,21,16,0.10)',
      }}
    >
      <DockBtn Icon={HandIcon} label="Move" active={isMove && !drawOpen} onClick={onMove} />
      <DockBtn Icon={PenIcon}  label="Draw" active={drawOpen}             onClick={onDraw} />
      <div className="h-px bg-ink/10 mx-1 my-[2px]" />
      <DockBtn Icon={UndoIcon} label="Undo" disabled={!canUndo} onClick={onUndo} />
      <DockBtn Icon={RedoIcon} label="Redo" disabled={!canRedo} onClick={onRedo} />
    </div>
  );
}
