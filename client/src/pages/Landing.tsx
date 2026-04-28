import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Landing() {
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = value.trim();

  async function handleJoin() {
    if (!trimmed) { setErr('Type a room name first.'); return; }
    setBusy(true); setErr(null);
    try {
      const room = await api.getRoom(trimmed);
      nav(`/r/${room.code}`);
    } catch {
      setErr(`No room called "${trimmed}". You can Create it instead.`);
    } finally { setBusy(false); }
  }

  async function handleCreate() {
    if (!trimmed) { setErr('Type a room name first.'); return; }
    setBusy(true); setErr(null);
    try {
      const room = await api.createRoom(trimmed);
      nav(`/r/${room.code}`);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('409') || msg.includes('name_taken')) {
        setErr(`"${trimmed}" is already taken — try Join, or pick a different name.`);
      } else if (msg.includes('400') || msg.includes('too_short')) {
        setErr('Use at least 2 letters/numbers.');
      } else {
        setErr(msg);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-ink text-paper flex items-center justify-center font-bold text-lg">M</div>
          <h1 className="text-4xl font-semibold tracking-tight">M-Board</h1>
        </div>
        <p className="text-ink/60 mb-8">A visual board for you and your people.</p>

        <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
          <div className="flex gap-2 items-stretch">
            <input
              autoFocus
              className="flex-1 rounded-lg border border-black/10 bg-paper px-3 py-2 focus:outline-none focus:border-black/40"
              placeholder="Room name (e.g. maher)"
              value={value}
              maxLength={30}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) handleCreate(); else handleJoin();
                }
              }}
            />
            <div className="flex flex-col gap-1 w-24">
              <button
                onClick={handleJoin}
                disabled={busy}
                className="rounded-lg bg-ink text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >Join</button>
              <button
                onClick={handleCreate}
                disabled={busy}
                className="rounded-md text-xs text-ink/70 hover:text-ink hover:underline py-1"
              >Create new</button>
            </div>
          </div>
          <p className="text-xs text-ink/50 mt-3">
            Pick any name (2–30 chars, letters/numbers/hyphens). The name <em>is</em> the link your friends use.
          </p>
        </div>

        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
