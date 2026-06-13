import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { MindMapPosition } from '../types';
import { MindMapIcon } from './icons';

interface Props {
  roomCode: string;
  crumbs: { _id: string; name: string }[];
  currentName: string;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  onRename: (name: string) => void;
  onAISubmit: (prompt: string) => void;
  aiLoading: boolean;
  // Mind map controls
  mindMapOpen: boolean;
  mindMapPosition: MindMapPosition;
  onToggleMindMap: () => void;
  onSetMindMapPosition: (p: MindMapPosition) => void;
}

// Slim 46px top bar pinned across the canvas area.
// Left:  parent-board breadcrumbs + inline-renamable current board name
// Right: mind-map toggle + saving indicator + room badge
export default function TopBar({
  roomCode, crumbs, currentName, saving, onRename,
  mindMapOpen, mindMapPosition, onToggleMindMap, onSetMindMapPosition,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(currentName);
  const parents = crumbs.slice(0, -1);

  function commit() {
    setEditing(false);
    if (val.trim() && val !== currentName) onRename(val.trim());
  }

  return (
    <div
      className="absolute top-0 left-0 right-0 h-[46px] z-[50] flex items-center gap-2 px-4 border-b border-ink/10"
      style={{ background: 'rgba(253,250,245,0.90)', backdropFilter: 'blur(14px)' }}
    >
      <span className="text-[12px] text-ink/50 font-medium">{roomCode}</span>
      <span className="text-[16px] text-ink/15">/</span>

      {parents.map((c) => (
        <span key={c._id} className="flex items-center gap-2">
          <Link
            to={`/r/${roomCode}/b/${c._id}`}
            className="text-[12px] text-ink/50 hover:text-ink hover:underline max-w-[14ch] truncate"
          >{c.name}</Link>
          <span className="text-[16px] text-ink/15">/</span>
        </span>
      ))}

      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setEditing(false); setVal(currentName); }
          }}
          className="text-[13px] font-bold text-ink bg-transparent border-0 outline outline-2 outline-amber rounded-md px-1.5 py-px"
        />
      ) : (
        <button
          onClick={() => { setVal(currentName); setEditing(true); }}
          title="Click to rename"
          className="text-[13px] font-bold text-ink cursor-text px-1 rounded-md hover:bg-ink/5"
        >{currentName}</button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {saving === 'saving' && <span className="text-[11px] text-ink/50 animate-pulse">Saving…</span>}
        {saving === 'saved'  && <span className="text-[11px] text-[#5cb85c]">✓ Saved</span>}
        {saving === 'error'  && <span className="text-[11px] text-[#e74c3c]">Save failed</span>}

        <MindMapButton
          open={mindMapOpen}
          position={mindMapPosition}
          onToggle={onToggleMindMap}
          onSetPosition={onSetMindMapPosition}
        />

        <div
          className="px-3 py-[3px] rounded-full text-[11px] font-bold tracking-[0.05em]"
          style={{ background: 'rgba(217,116,53,0.11)', color: '#D97435' }}
        >{roomCode}</div>
      </div>
    </div>
  );
}

// Mind-map toggle: the main button shows/hides the map; the caret opens a
// small menu to choose where it docks (which also opens it there).
function MindMapButton({
  open, position, onToggle, onSetPosition,
}: {
  open: boolean;
  position: MindMapPosition;
  onToggle: () => void;
  onSetPosition: (p: MindMapPosition) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    // Anchor the (portalled) menu under the button cluster.
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const options: { p: MindMapPosition; label: string }[] = [
    { p: 'left', label: 'Dock left' },
    { p: 'right', label: 'Dock right' },
    { p: 'full', label: 'Full screen' },
  ];

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={onToggle}
        title={open ? 'Hide mind map' : 'Show mind map'}
        className="h-7 pl-2 pr-1.5 rounded-l-lg flex items-center gap-1.5 text-[11px] font-bold transition-all border"
        style={{
          background: open ? '#D97435' : 'rgba(253,250,245,0.9)',
          color: open ? 'white' : '#D97435',
          borderColor: 'rgba(217,116,53,0.4)',
        }}
      >
        <MindMapIcon size={14} />
        Mind Map
      </button>
      <button
        onClick={() => setMenu((m) => !m)}
        title="Where to show it"
        className="h-7 px-1 rounded-r-lg flex items-center transition-all border border-l-0"
        style={{
          background: open ? '#D97435' : 'rgba(253,250,245,0.9)',
          color: open ? 'white' : '#D97435',
          borderColor: 'rgba(217,116,53,0.4)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed min-w-[150px] py-1 rounded-xl text-[12px] text-ink"
          style={{
            top: menuPos.top,
            right: menuPos.right,
            zIndex: 300000,
            background: 'rgba(253,250,245,0.98)',
            border: '1px solid rgba(26,21,16,0.10)',
            boxShadow: '0 10px 28px rgba(26,21,16,0.18)',
          }}
        >
          {options.map(({ p, label }) => (
            <button
              key={p}
              onClick={() => { onSetPosition(p); setMenu(false); }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-ink/[0.06] transition-colors"
            >
              <span>{label}</span>
              {open && position === p && <span className="text-amber font-bold">●</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
