import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { loadIdentity, saveIdentity } from '../lib/identity';
import {
  AuthNotConfiguredError,
  isAuthConfigured,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/auth';

// ── Random username generator ────────────────────────────────────────
// Only used to seed a friendly default display name; there is no visible
// "shuffle" control — the placeholder simply shows the suggestion.
const ADJECTIVES = [
  'Quick', 'Calm', 'Brave', 'Bright', 'Lucky', 'Witty', 'Cosy', 'Bold',
  'Sunny', 'Mellow', 'Swift', 'Curious', 'Happy', 'Quiet', 'Loose', 'Sharp',
];
const ANIMALS = [
  'Fox', 'Otter', 'Panda', 'Hawk', 'Lynx', 'Whale', 'Tiger', 'Crane',
  'Bison', 'Heron', 'Koala', 'Moth', 'Owl', 'Puma', 'Seal', 'Yak',
];
function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a}${b}${Math.floor(Math.random() * 90 + 10)}`;
}

type Tab = 'quick' | 'signin';
type Mode = 'signin' | 'signup';

export default function Landing() {
  const nav = useNavigate();

  // ── Shared room state ─────────────────────────────────────────────
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Quick-join state ──────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('quick');
  const existing = useMemo(() => loadIdentity(), []);
  const [randomDefault] = useState<string>(() => existing?.name ?? randomName());
  const [name, setName] = useState<string>(existing?.name ?? '');
  const [nameIsCustom, setNameIsCustom] = useState<boolean>(!!existing?.name);

  // ── Sign-in state ─────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const trimmedRoom = room.trim();

  function persistIdentity() {
    const n = name.trim() || randomDefault;
    saveIdentity(n);
  }

  async function handleJoin() {
    if (!trimmedRoom) { setErr('Type a room name to join.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.getRoom(trimmedRoom);
      persistIdentity();
      nav(`/r/${r.code}`);
    } catch {
      setErr(`No room called "${trimmedRoom}" — try Create to make it.`);
    } finally { setBusy(false); }
  }

  async function handleCreate() {
    if (!trimmedRoom) { setErr('Type a room name to create.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createRoom(trimmedRoom);
      persistIdentity();
      nav(`/r/${r.code}`);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('409') || msg.includes('name_taken')) {
        setErr(`"${trimmedRoom}" is taken — try Join, or pick a different name.`);
      } else if (msg.includes('400') || msg.includes('too_short')) {
        setErr('Room name needs at least 2 letters or numbers.');
      } else {
        setErr(msg);
      }
    } finally { setBusy(false); }
  }

  async function handleGoogle() {
    setBusy(true); setErr(null);
    try {
      const user = await signInWithGoogle();
      saveIdentity(user.displayName || user.email || 'User');
      if (trimmedRoom) await handleJoin(); else setErr('Signed in. Now type a room name to continue.');
    } catch (e) {
      setErr(e instanceof AuthNotConfiguredError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function handleEmail() {
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return; }
    setBusy(true); setErr(null);
    try {
      const user = mode === 'signin'
        ? await signInWithEmail(email.trim(), password)
        : await signUpWithEmail(email.trim(), password);
      saveIdentity(user.displayName || user.email || 'User');
      if (trimmedRoom) await handleJoin(); else setErr('Signed in. Now type a room name to continue.');
    } catch (e) {
      setErr(e instanceof AuthNotConfiguredError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div
      className="min-h-screen font-sans text-ink flex flex-col board-bg"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 70% 45% at 50% -10%, rgba(217,116,53,0.16), transparent 60%),' +
          'radial-gradient(ellipse 45% 30% at 88% 8%, rgba(232,184,48,0.12), transparent 70%),' +
          'radial-gradient(rgba(26,21,16,0.07) 1px, transparent 1px)',
        backgroundSize: 'auto, auto, 24px 24px',
      }}
    >
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] flex flex-col items-center animate-fadeUp">
          {/* Brand — the logo IS the headline. */}
          <Logo className="h-14 sm:h-16 mb-4" />
          <p className="text-[15px] sm:text-[16px] text-ink/55 text-center leading-relaxed mb-8 max-w-[360px]">
            An infinite sheet of paper for notes, sketches &amp; ideas — together.
          </p>

          {/* ── Join / sign-in card ─────────────────────────────── */}
          <div
            className="rounded-[24px] border border-ink/10 p-6 sm:p-7 w-full"
            style={{ background: '#FDFAF5', boxShadow: '0 16px 50px rgba(26,21,16,0.10)' }}
          >
            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-cream/80 border border-ink/10 mb-5">
              <TabBtn active={tab === 'quick'} onClick={() => { setTab('quick'); setErr(null); }}>
                Quick join
              </TabBtn>
              <TabBtn active={tab === 'signin'} onClick={() => { setTab('signin'); setErr(null); }}>
                Sign in
              </TabBtn>
            </div>

            {/* Room name (shared by both tabs) */}
            <Field label="Room name">
              <input
                autoFocus
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tab === 'quick') {
                    if (e.shiftKey) handleCreate(); else handleJoin();
                  }
                }}
                placeholder="Enter room name"
                maxLength={30}
                className="w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors"
              />
            </Field>

            {tab === 'quick' ? (
              <>
                <Field label="Your name">
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); setNameIsCustom(true); }}
                    maxLength={24}
                    placeholder={randomDefault}
                    className="w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors"
                    style={{ color: nameIsCustom ? '#1A1510' : 'rgba(26,21,16,0.38)' }}
                  />
                </Field>
                <div className="flex gap-2.5 mt-5">
                  <button
                    onClick={handleJoin}
                    disabled={busy}
                    className="flex-1 py-[13px] rounded-xl text-white font-bold text-[15px] disabled:opacity-50 transition-transform active:scale-[0.99]"
                    style={{
                      background: 'linear-gradient(135deg, #D97435, #F08848)',
                      boxShadow: '0 3px 16px rgba(217,116,53,0.40)',
                    }}
                  >Join room →</button>
                  <button
                    onClick={handleCreate}
                    disabled={busy}
                    className="px-5 py-[13px] rounded-xl text-ink font-semibold text-[14px] disabled:opacity-50 border-2 border-ink/10 bg-paper hover:border-ink/20"
                  >Create</button>
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={handleGoogle}
                  disabled={busy}
                  className="w-full mt-1 py-[12px] rounded-xl bg-paper border-2 border-ink/10 hover:border-ink/20 font-semibold text-[15px] flex items-center justify-center gap-2.5 disabled:opacity-50"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-ink/10" />
                  <span className="text-[11px] text-ink/45 font-semibold uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-ink/10" />
                </div>
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors"
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleEmail(); }}
                    placeholder="••••••••"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    className="w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors"
                  />
                </Field>
                <button
                  onClick={handleEmail}
                  disabled={busy}
                  className="w-full mt-2 py-[13px] rounded-xl text-white font-bold text-[15px] disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #D97435, #F08848)',
                    boxShadow: '0 3px 16px rgba(217,116,53,0.40)',
                  }}
                >{mode === 'signin' ? 'Sign in' : 'Create account'} →</button>
                <p className="text-[12px] text-ink/55 mt-3 text-center">
                  {mode === 'signin' ? "Don't have an account?" : 'Already have one?'}{' '}
                  <button
                    type="button"
                    onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setErr(null); }}
                    className="font-semibold text-amber hover:underline"
                  >{mode === 'signin' ? 'Sign up' : 'Sign in'}</button>
                </p>
                {!isAuthConfigured && (
                  <p className="text-[11px] text-ink/50 mt-3 text-center leading-snug">
                    Sign-in is being set up. For now, use <button
                      type="button"
                      onClick={() => setTab('quick')}
                      className="font-semibold text-amber hover:underline"
                    >Quick join</button>.
                  </p>
                )}
              </>
            )}

            {err && (
              <p className="mt-4 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {err}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Small building blocks ──────────────────────────────────────────

// Brand mark. Uses the committed logo asset at /mypapr-logo.svg and falls
// back to a clean text wordmark if the file isn't present yet, so the page
// never shows a broken image.
function Logo({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={`select-none ${className ?? ''}`}
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
          fontWeight: 700,
          fontSize: '42px',
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: '#1A1510',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >Mypapr</span>
    );
  }
  return (
    <img
      src="/mypapr-logo.png"
      alt="Mypapr"
      className={className}
      style={{ width: 'auto', objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-[11px] font-bold text-ink/55 uppercase tracking-[0.09em] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
        active ? 'bg-paper text-ink shadow-sm' : 'text-ink/55 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  );
}
