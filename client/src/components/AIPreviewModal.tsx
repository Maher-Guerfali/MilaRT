import type { AIOperation, BaseItem } from '../types';

interface Props {
  explanation: string;
  operations: AIOperation[];
  items: BaseItem[];
  onApply: () => void;
  onDiscard: () => void;
}

function opLabel(op: AIOperation, items: BaseItem[]): string {
  const name = (id?: string) => {
    if (!id) return '?';
    const it = items.find((x) => x.id === id);
    if (!it) return id.slice(0, 12);
    if (it.type === 'sticky') return `sticky "${String((it.data as { text?: string }).text ?? '').slice(0, 20)}"`;
    if (it.type === 'image') return 'image';
    if (it.type === 'link') return `link "${String((it.data as { title?: string }).title ?? '').slice(0, 20)}"`;
    if (it.type === 'board') return `board "${String((it.data as { name?: string }).name ?? '').slice(0, 20)}"`;
    return it.type;
  };

  switch (op.type) {
    case 'move':
      return `Move ${name(op.id)} → (${Math.round(op.x ?? 0)}, ${Math.round(op.y ?? 0)})`;
    case 'resize':
      return `Resize ${name(op.id)} → ${Math.round(op.w ?? 0)} × ${Math.round(op.h ?? 0)}`;
    case 'update': {
      const fields = Object.keys(op.data ?? {}).join(', ');
      return `Update ${name(op.id)} — set ${fields}`;
    }
    case 'add': {
      const it = op.item;
      if (!it) return 'Add item';
      const label = it.type === 'sticky'
        ? `sticky "${String((it.data as { text?: string }).text ?? '').slice(0, 28)}"`
        : it.type;
      return `Add ${label}`;
    }
    case 'delete':
      return `Delete ${name(op.id)}`;
    default:
      return String(op.type);
  }
}

const OP_COLOR: Record<string, string> = {
  move:   'bg-blue-50 text-blue-700 border-blue-200',
  resize: 'bg-purple-50 text-purple-700 border-purple-200',
  update: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  add:    'bg-green-50 text-green-700 border-green-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
};

export default function AIPreviewModal({ explanation, operations, items, onApply, onDiscard }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4"
         style={{ background: 'rgba(26,21,16,0.45)', backdropFilter: 'blur(4px)' }}>
      <div
        className="w-full max-w-md rounded-2xl border border-ink/10 flex flex-col"
        style={{ background: '#FDFAF5', boxShadow: '0 24px 60px rgba(26,21,16,0.22)' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-ink/8 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
               style={{ background: 'rgba(217,116,53,0.12)' }}>
            <SparkleIcon />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ink">AI will make {operations.length} change{operations.length !== 1 ? 's' : ''}</p>
            <p className="text-[12px] text-ink/60 mt-0.5 leading-snug">{explanation}</p>
          </div>
        </div>

        {/* Operations list */}
        {operations.length > 0 && (
          <div className="px-4 py-3 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {operations.map((op, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11.5px] font-medium ${OP_COLOR[op.type] ?? 'bg-ink/5 text-ink/60 border-ink/10'}`}
              >
                <span className="uppercase text-[9px] font-bold tracking-wider opacity-70 w-12 shrink-0">{op.type}</span>
                <span className="truncate">{opLabel(op, items)}</span>
              </div>
            ))}
          </div>
        )}

        {operations.length === 0 && (
          <p className="px-5 py-4 text-[12px] text-ink/40 italic">No changes needed.</p>
        )}

        {/* Footer buttons */}
        <div className="px-4 pb-4 pt-2 flex gap-2">
          <button
            onClick={onDiscard}
            className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-ink/60 border border-ink/12 hover:bg-ink/5 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onApply}
            className="flex-1 h-9 rounded-xl text-[13px] font-semibold text-white transition-colors"
            style={{ background: '#D97435' }}
            disabled={operations.length === 0}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97435" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.636 5.636l2.122 2.122M16.243 16.243l2.121 2.121M5.636 18.364l2.122-2.121M16.243 7.757l2.121-2.121" />
    </svg>
  );
}
