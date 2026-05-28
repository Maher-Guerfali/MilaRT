import { useState, type ReactNode } from 'react';

type Side = 'right' | 'top' | 'bottom' | 'left';

interface Props {
  label?: ReactNode;
  side?: Side;
  children: ReactNode;
}

// Lightweight tooltip — pops in on hover with a small triangle arrow.
// Mirrors the design's <Tip> behavior.
export default function Tooltip({ label, side = 'right', children }: Props) {
  const [show, setShow] = useState(false);
  if (!label) return <>{children}</>;

  const pos: React.CSSProperties =
    side === 'right'  ? { left:'calc(100% + 10px)', top:'50%', transform:'translateY(-50%)' }
  : side === 'left'   ? { right:'calc(100% + 10px)', top:'50%', transform:'translateY(-50%)' }
  : side === 'bottom' ? { top:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)' }
  :                     { bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)' };

  const arrow: React.CSSProperties =
    side === 'right'  ? { position:'absolute', right:'100%', top:'50%', transform:'translateY(-50%)', width:0, height:0, borderTop:'5px solid transparent', borderBottom:'5px solid transparent', borderRight:`5px solid #1A1510` }
  : side === 'left'   ? { position:'absolute', left:'100%', top:'50%', transform:'translateY(-50%)', width:0, height:0, borderTop:'5px solid transparent', borderBottom:'5px solid transparent', borderLeft:`5px solid #1A1510` }
  : side === 'bottom' ? { position:'absolute', bottom:'100%', left:'50%', transform:'translateX(-50%)', width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderBottom:`5px solid #1A1510` }
  :                     { position:'absolute', top:'100%', left:'50%', transform:'translateX(-50%)', width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:`5px solid #1A1510` };

  return (
    <div
      className="relative flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className="absolute bg-ink text-paper text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap pointer-events-none z-[9999] animate-tooltipIn shadow-lg"
          style={pos}
        >
          {label}
          <span style={arrow} />
        </div>
      )}
    </div>
  );
}
