import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  roomCode: string;
  crumbs: { _id: string; name: string }[];
  currentName: string;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  onRename: (name: string) => void;
  onAISubmit: (prompt: string) => void;
  aiLoading: boolean;
}

// Slim 46px top bar pinned across the canvas area.
// Left:  parent-board breadcrumbs + inline-renamable current board name
// Right: AI input toggle + saving indicator + room badge
export default function TopBar({ roomCode, crumbs, currentName, saving, onRename, onAISubmit, aiLoading }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(currentName);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const aiInputRef = useRef<HTMLInputElement>(null);
  const parents = crumbs.slice(0, -1);

  function commit() {
    setEditing(false);
    if (val.trim() && val !== currentName) onRename(val.trim());
  }

  function submitAI() {
    const p = aiPrompt.trim();
    if (!p || aiLoading) return;
    onAISubmit(p);
    setAiPrompt('');
    setAiOpen(false);
  }

  function toggleAI() {
    setAiOpen((o) => {
      if (!o) setTimeout(() => aiInputRef.current?.focus(), 50);
      return !o;
    });
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
        {/* AI input area */}
        {aiOpen && (
          <div className="flex items-center gap-1 animate-fadeIn">
            <input
              ref={aiInputRef}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAI();
                if (e.key === 'Escape') { setAiOpen(false); setAiPrompt(''); }
              }}
              placeholder="Ask AI to do something…"
              className="w-56 h-7 px-3 text-[12px] rounded-full border border-ink/15 bg-white/80 outline-none focus:border-amber focus:ring-2 focus:ring-amber/20"
              style={{ fontFamily: 'inherit' }}
              disabled={aiLoading}
            />
            <button
              onClick={submitAI}
              disabled={!aiPrompt.trim() || aiLoading}
              className="h-7 px-3 rounded-full text-[11px] font-semibold text-white transition-all disabled:opacity-40"
              style={{ background: '#D97435' }}
            >
              {aiLoading ? '…' : 'Go'}
            </button>
          </div>
        )}

        {/* AI toggle button */}
        <button
          onClick={toggleAI}
          title="AI assistant"
          className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${aiOpen ? 'text-amber' : 'text-ink/50 hover:text-ink hover:bg-ink/5'}`}
          style={aiOpen ? { background: 'rgba(217,116,53,0.12)' } : undefined}
        >
          {aiLoading
            ? <span className="text-[13px] animate-pulse">✦</span>
            : <SparkleIcon />}
        </button>

        {saving === 'saving' && <span className="text-[11px] text-ink/50 animate-pulse">Saving…</span>}
        {saving === 'saved'  && <span className="text-[11px] text-[#5cb85c]">✓ Saved</span>}
        {saving === 'error'  && <span className="text-[11px] text-[#e74c3c]">Save failed</span>}
        <div
          className="px-3 py-[3px] rounded-full text-[11px] font-bold tracking-[0.05em]"
          style={{ background: 'rgba(217,116,53,0.11)', color: '#D97435' }}
        >{roomCode}</div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.636 5.636l2.122 2.122M16.243 16.243l2.121 2.121M5.636 18.364l2.122-2.121M16.243 7.757l2.121-2.121" />
    </svg>
  );
}

