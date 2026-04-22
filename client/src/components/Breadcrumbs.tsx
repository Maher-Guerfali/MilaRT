import { useState } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  roomCode: string;
  crumbs: { _id: string; name: string }[];
  currentName: string;
  onRename: (name: string) => void;
}

export default function Breadcrumbs({ roomCode, crumbs, currentName, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(currentName);

  return (
    <div className="absolute top-3 left-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/90 border border-black/10 px-2 py-1 text-sm shadow-sm">
        {crumbs.slice(0, -1).map((c) => (
          <span key={c._id} className="flex items-center gap-1">
            <Link to={`/r/${roomCode}/b/${c._id}`} className="text-ink/60 hover:text-ink hover:underline max-w-[12ch] truncate">{c.name}</Link>
            <span className="text-ink/30">/</span>
          </span>
        ))}
        {editing ? (
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => { setEditing(false); if (val !== currentName) onRename(val); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setEditing(false); if (val !== currentName) onRename(val); }
              if (e.key === 'Escape') { setEditing(false); setVal(currentName); }
            }}
            className="bg-transparent outline-none border-b border-ink/30 min-w-[6ch]"
          />
        ) : (
          <button onClick={() => { setVal(currentName); setEditing(true); }} className="font-medium">
            {currentName}
          </button>
        )}
      </div>
    </div>
  );
}
