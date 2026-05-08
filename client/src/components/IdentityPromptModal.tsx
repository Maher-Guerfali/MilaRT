import { useEffect, useRef, useState } from 'react';

interface Props {
  initialName?: string;
  onSubmit: (name: string) => void;
  /** Optional close — only shown when editing an existing name. */
  onCancel?: () => void;
}

// Friendly anonymous defaults so the placeholder doesn't feel empty.
const ANIMALS = [
  'Otter', 'Fox', 'Bear', 'Lynx', 'Heron', 'Whale', 'Hawk',
  'Badger', 'Moth', 'Bison', 'Crane', 'Wolf',
];
function randomAnimal() {
  return ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
}

export default function IdentityPromptModal({ initialName, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initialName ?? '');
  const placeholderRef = useRef(randomAnimal());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    const final = name.trim() || placeholderRef.current;
    onSubmit(final);
  }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4"
      style={{ background: 'rgba(26,21,16,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-ink/10 flex flex-col"
        style={{ background: '#FDFAF5', boxShadow: '0 24px 60px rgba(26,21,16,0.25)' }}
      >
        <div className="px-5 pt-5 pb-3">
          <p className="text-[14px] font-semibold text-ink">What should we call you?</p>
          <p className="text-[12px] text-ink/60 mt-1 leading-snug">
            Other people in this room will see your name next to your cursor. You can change it any time.
          </p>
        </div>

        <div className="px-5 pb-2">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={placeholderRef.current}
            maxLength={24}
            className="w-full h-10 px-3 rounded-xl border border-ink/15 bg-white text-[13.5px] text-ink outline-none focus:border-ink/40 transition-colors"
          />
        </div>

        <div className="px-5 pb-5 pt-2 flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors"
            style={{ background: '#D97435' }}
          >
            Join room
          </button>
        </div>
      </div>
    </div>
  );
}
