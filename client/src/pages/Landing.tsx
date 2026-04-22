import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true); setErr(null);
    try {
      const room = await api.createRoom(name || undefined);
      nav(`/r/${room.code}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  async function handleJoin() {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) { setErr('Room codes are 6 characters.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.getRoom(c);
      nav(`/r/${c}`);
    } catch (e) {
      setErr('No room with that code.');
      void e;
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-semibold tracking-tight mb-2">MilaRT</h1>
        <p className="text-ink/60 mb-8">A visual board for you and your people.</p>

        <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-6 mb-4">
          <label className="block text-sm font-medium mb-2">Create a new room</label>
          <input
            className="w-full rounded-lg border border-black/10 bg-paper px-3 py-2 mb-3 focus:outline-none focus:border-black/40"
            placeholder="Room name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={handleCreate}
            disabled={busy}
            className="w-full rounded-lg bg-ink text-paper py-2 font-medium hover:opacity-90 disabled:opacity-50"
          >Create room</button>
        </div>

        <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-6">
          <label className="block text-sm font-medium mb-2">Join with a code</label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-black/10 bg-paper px-3 py-2 font-mono uppercase tracking-widest focus:outline-none focus:border-black/40"
              placeholder="ABC123"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button
              onClick={handleJoin}
              disabled={busy}
              className="rounded-lg border border-ink/20 px-4 py-2 font-medium hover:bg-ink hover:text-paper disabled:opacity-50"
            >Join</button>
          </div>
        </div>

        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
