import { nanoid } from 'nanoid';
import type { BaseItem } from '../types';

interface Props {
  roomCode: string;
  onAdd: (item: BaseItem) => void;
  onRefresh: () => void;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: Date | null;
}

const STICKY_COLORS = ['#fff7ae', '#d8f2c4', '#ffd1d1', '#d5e8ff', '#eadcff'];

function newItem(partial: Partial<BaseItem>): BaseItem {
  return {
    id: nanoid(10),
    type: 'sticky',
    x: 100 + Math.random() * 120,
    y: 100 + Math.random() * 120,
    w: 220,
    h: 160,
    z: 0,
    data: {},
    ...partial,
  } as BaseItem;
}

export default function Sidebar({ roomCode, onAdd, onRefresh, saving, lastSavedAt }: Props) {
  const tools: { label: string; make: () => BaseItem }[] = [
    {
      label: 'Sticky note',
      make: () => newItem({
        type: 'sticky',
        data: { text: '', color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)] },
      }),
    },
    {
      label: 'Link / text',
      make: () => newItem({
        type: 'link',
        w: 260, h: 90,
        data: { url: '', title: '' },
      }),
    },
    {
      label: 'Nested board',
      make: () => newItem({
        type: 'board',
        w: 220, h: 140,
        data: { name: 'New board' },
      }),
    },
    {
      label: 'Handwriting',
      make: () => newItem({
        type: 'handwriting',
        w: 320, h: 220,
        data: { strokes: [] },
      }),
    },
  ];

  function copyCode() {
    navigator.clipboard?.writeText(roomCode);
  }

  const savingLabel =
    saving === 'saving' ? 'Saving…' :
    saving === 'saved' ? `Saved${lastSavedAt ? ' ' + timeAgo(lastSavedAt) : ''}` :
    saving === 'error' ? 'Save failed' : ' ';

  return (
    <aside className="w-56 shrink-0 border-r border-black/10 bg-white/70 backdrop-blur flex flex-col">
      <div className="px-4 py-4 border-b border-black/5">
        <div className="text-xs uppercase tracking-wider text-ink/50">Room</div>
        <button
          onClick={copyCode}
          className="mt-1 font-mono text-lg tracking-widest hover:underline"
          title="Click to copy"
        >{roomCode}</button>
      </div>

      <div className="px-4 py-4 border-b border-black/5">
        <div className="text-xs uppercase tracking-wider text-ink/50 mb-2">Add</div>
        <div className="flex flex-col gap-1">
          {tools.map((t) => (
            <button
              key={t.label}
              onClick={() => onAdd(t.make())}
              className="text-left rounded-md px-3 py-2 text-sm hover:bg-ink hover:text-paper"
            >{t.label}</button>
          ))}
        </div>
        <p className="text-xs text-ink/50 mt-3">Tip: paste an image anywhere on the board.</p>
      </div>

      <div className="mt-auto px-4 py-4 border-t border-black/5 text-xs text-ink/60 space-y-2">
        <div>{savingLabel}</div>
        <button
          onClick={onRefresh}
          className="w-full rounded-md border border-ink/20 px-3 py-2 hover:bg-ink hover:text-paper"
        >Refresh from server</button>
      </div>
    </aside>
  );
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
