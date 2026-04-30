import { useState } from 'react';

interface Props {
  onClose: () => void;
}

const STEPS = [
  {
    title: 'Add elements to the canvas',
    text: 'Drag any item from the left sidebar and drop it anywhere on the canvas.',
    Illustration: DragIllustration,
  },
  {
    title: 'Select, scale & delete',
    text: 'Tap an element to select it. Use the handles to resize. Press Delete or use the trash icon to remove it. Tap a nested board to enter it.',
    Illustration: SelectIllustration,
  },
  {
    title: 'Drawing & Apple Pencil mode',
    text: 'Press the Draw button (top-right) to open the draw tray. Enable the pencil-only toggle next to the pen tool to ignore your palm — ideal on iPad with Apple Pencil.',
    Illustration: DrawIllustration,
  },
  {
    title: 'You\'re all set — enjoy!',
    text: 'Everything auto-saves. Undo / redo with ⌘Z. Share your room code with friends so you can collaborate. Have fun!',
    Illustration: EnjoyIllustration,
  },
];

export default function TutorialModal({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const { title, text, Illustration } = STEPS[step];
  const isLast = step === total - 1;

  function next() {
    if (isLast) { onClose(); return; }
    setStep((s) => s + 1);
  }
  function prev() { setStep((s) => Math.max(0, s - 1)); }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div
        className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: '#FDFAF5' }}
      >
        {/* Illustration area */}
        <div
          className="w-full flex items-center justify-center"
          style={{ height: 200, background: 'linear-gradient(135deg, #FFF3E0, #FDE8C8)' }}
        >
          <Illustration />
        </div>

        {/* Content */}
        <div className="px-7 pt-5 pb-6">
          {/* Step dots */}
          <div className="flex gap-[6px] justify-center mb-4">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? 20 : 7,
                  height: 7,
                  background: i === step ? '#D97435' : 'rgba(26,21,16,0.15)',
                }}
              />
            ))}
          </div>

          <h2 className="text-[18px] font-bold text-ink text-center leading-snug mb-2">{title}</h2>
          <p className="text-[13.5px] text-ink/60 text-center leading-relaxed mb-6">{text}</p>

          <div className="flex gap-3">
            {step > 0 && (
              <button
                onClick={prev}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-ink/15 text-ink/60 hover:bg-ink/5 transition-colors"
              >Back</button>
            )}
            <button
              onClick={next}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{
                background: 'linear-gradient(135deg, #D97435, #F08848)',
                boxShadow: '0 4px 14px rgba(217,116,53,0.35)',
              }}
            >{isLast ? 'Get started' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Illustrations ──────────────────────────────────────── */

function DragIllustration() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" fill="none">
      {/* Sidebar strip */}
      <rect x="8" y="20" width="36" height="110" rx="10" fill="#E8DDD0" />
      <rect x="16" y="34" width="20" height="18" rx="5" fill="#FFF3C4" />
      <rect x="16" y="58" width="20" height="18" rx="5" fill="#D4F0DE" />
      <rect x="16" y="82" width="20" height="18" rx="5" fill="#E0EDFF" />

      {/* Canvas area */}
      <rect x="56" y="20" width="136" height="110" rx="10" fill="#F5EFE6" stroke="#E0D5C5" strokeWidth="1" />

      {/* Dragged item */}
      <rect x="90" y="55" width="56" height="40" rx="8" fill="#FFF3C4"
        style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.18))' }} />
      <line x1="97" y1="70" x2="138" y2="70" stroke="#C8B060" strokeWidth="2" strokeLinecap="round" />
      <line x1="97" y1="78" x2="128" y2="78" stroke="#C8B060" strokeWidth="2" strokeLinecap="round" />

      {/* Arrow */}
      <path d="M44 70 Q66 68 86 72" stroke="#D97435" strokeWidth="2.5" strokeDasharray="5 3"
        strokeLinecap="round" fill="none" />
      <polygon points="86,67 94,72 86,77" fill="#D97435" />

      {/* Hand cursor */}
      <text x="60" y="54" fontSize="20" style={{ userSelect: 'none' }}>👆</text>
    </svg>
  );
}

function SelectIllustration() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" fill="none">
      {/* Canvas */}
      <rect x="16" y="16" width="168" height="118" rx="12" fill="#F5EFE6" stroke="#E0D5C5" strokeWidth="1" />

      {/* Card */}
      <rect x="50" y="35" width="100" height="62" rx="9" fill="#FFF3C4"
        style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.12))' }} />
      {/* Selection border */}
      <rect x="46" y="31" width="108" height="70" rx="11" fill="none"
        stroke="#D97435" strokeWidth="2" strokeDasharray="5 3" />
      {/* Resize handles */}
      {[[46,31],[154,31],[46,101],[154,101],[100,31],[100,101],[46,66],[154,66]].map(([x,y],i)=>(
        <rect key={i} x={x-4} y={y-4} width="8" height="8" rx="2" fill="white"
          stroke="#D97435" strokeWidth="1.5" />
      ))}

      {/* Delete button */}
      <circle cx="154" cy="31" r="11" fill="#E74C3C" />
      <line x1="150" y1="27" x2="158" y2="35" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <line x1="158" y1="27" x2="150" y2="35" stroke="white" strokeWidth="2" strokeLinecap="round" />

      {/* Enter arrow on board */}
      <rect x="54" y="40" width="44" height="32" rx="6" fill="#E0EDFF" />
      <text x="62" y="61" fontSize="16" style={{ userSelect: 'none' }}>→</text>
    </svg>
  );
}

function DrawIllustration() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" fill="none">
      {/* Canvas */}
      <rect x="16" y="16" width="134" height="118" rx="12" fill="#F5EFE6" stroke="#E0D5C5" strokeWidth="1" />

      {/* Stroke paths */}
      <path d="M36 110 Q55 70 80 88 Q105 106 120 60" stroke="#D97435"
        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M36 78 Q60 58 90 72 Q115 85 130 50" stroke="#2a9d8f"
        strokeWidth="2" strokeLinecap="round" fill="none" />

      {/* Apple Pencil */}
      <g transform="translate(155 20) rotate(30)">
        <rect x="0" y="0" width="12" height="60" rx="5" fill="#F5C030" />
        <rect x="0" y="0" width="12" height="8" rx="4" fill="#FFB3BA" />
        <rect x="0" y="56" width="12" height="6" rx="2" fill="#B8C4D0" />
        <polygon points="0,62 12,62 6,75" fill="#C8920A" />
        <polygon points="4,72 8,72 6,76" fill="#555" />
      </g>

      {/* Draw button */}
      <rect x="158" y="48" width="34" height="30" rx="8"
        fill="url(#drawGrad)" />
      <defs>
        <linearGradient id="drawGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D97435" />
          <stop offset="100%" stopColor="#F08848" />
        </linearGradient>
      </defs>
      <text x="162" y="68" fontSize="18" fill="white" style={{ userSelect: 'none' }}>✏️</text>
    </svg>
  );
}

function EnjoyIllustration() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" fill="none">
      {/* Big M logo */}
      <rect x="72" y="28" width="56" height="56" rx="16"
        style={{ fill: 'url(#mGrad)' }} />
      <defs>
        <linearGradient id="mGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D97435" />
          <stop offset="100%" stopColor="#E8B830" />
        </linearGradient>
      </defs>
      <text x="83" y="68" fontSize="32" fontWeight="900" fill="white"
        style={{ userSelect: 'none', fontFamily: 'sans-serif' }}>M</text>

      {/* Stars / sparkles */}
      {([
        [40, 35, 10], [160, 40, 8], [28, 80, 7], [172, 90, 9], [55, 120, 8], [148, 118, 7],
      ] as [number, number, number][]).map(([cx, cy, r], i) => (
        <g key={i}>
          <line x1={cx - r} y1={cy} x2={cx + r} y2={cy}
            stroke="#D97435" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
          <line x1={cx} y1={cy - r} x2={cx} y2={cy + r}
            stroke="#D97435" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
          <line x1={cx - r * 0.7} y1={cy - r * 0.7} x2={cx + r * 0.7} y2={cy + r * 0.7}
            stroke="#E8B830" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        </g>
      ))}

      {/* Tagline */}
      <text x="100" y="110" textAnchor="middle" fontSize="12" fill="#D97435"
        fontWeight="600" style={{ userSelect: 'none', fontFamily: 'sans-serif', letterSpacing: 1 }}>
        Let's create!
      </text>
    </svg>
  );
}
