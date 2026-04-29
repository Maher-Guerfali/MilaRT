import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Landing() {
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [focus, setFocus] = useState(false);
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
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: 'radial-gradient(ellipse 90% 55% at 50% -5%, rgba(217,116,53,0.13), transparent 65%), #F3EDE0',
      }}
    >
      <div className="w-full max-w-[420px] animate-fadeUp">
        <div className="flex items-center gap-3.5 mb-2">
          <div
            className="w-[50px] h-[50px] rounded-2xl flex items-center justify-center text-white font-extrabold text-2xl"
            style={{
              background: 'linear-gradient(140deg, #D97435, #E8B830)',
              boxShadow: '0 6px 20px rgba(217,116,53,0.50)',
            }}
          >M</div>
          <div>
            <h1 className="text-[28px] font-extrabold text-ink tracking-tight leading-tight">MaherBoard</h1>
            <p className="text-[13px] text-ink/50 mt-0.5">Your visual thinking space</p>
          </div>
        </div>

        <div className="h-7" />

        <div
          className="rounded-[22px] border border-ink/10 p-7"
          style={{ background: '#FDFAF5', boxShadow: '0 8px 40px rgba(26,21,16,0.09)' }}
        >
          <label className="block text-[11px] font-bold text-ink/50 uppercase tracking-[0.09em] mb-2">Room name</label>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) handleCreate(); else handleJoin();
              }
            }}
            placeholder="e.g. maher-projects"
            maxLength={30}
            className="w-full px-4 py-[13px] rounded-2xl text-[15px] text-ink outline-none transition-colors"
            style={{
              border: `2px solid ${focus ? '#D97435' : 'rgba(26,21,16,0.10)'}`,
              background: '#F3EDE0',
            }}
          />
          <div className="flex gap-2.5 mt-3.5">
            <button
              onClick={handleJoin}
              disabled={busy}
              className="flex-1 py-[13px] rounded-2xl border-0 text-white font-bold text-[15px] disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #D97435, #F08848)',
                boxShadow: '0 3px 16px rgba(217,116,53,0.40)',
              }}
            >Join room →</button>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="px-5 py-[13px] rounded-2xl text-ink/50 font-semibold text-[14px] disabled:opacity-50"
              style={{
                border: '2px solid rgba(26,21,16,0.10)',
                background: 'transparent',
              }}
            >Create</button>
          </div>
          <p className="text-[11px] text-ink/50 mt-3 leading-snug">
            Pick any name (2–30 chars, letters/numbers/hyphens). The name <em>is</em> the link your friends use.
          </p>
        </div>

        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
