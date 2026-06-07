import { useEffect, useMemo, useState } from 'react';
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

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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

  // ── Mobile nav ────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);

  // The canvas app sets `body { touch-action: none }` globally to stop the
  // page from panning/bouncing while drawing. That also kills touch
  // scrolling on this (scrollable) landing page, so relax it while mounted
  // and restore it on the way out.
  useEffect(() => {
    const body = document.body;
    const prev = body.style.touchAction;
    body.style.touchAction = 'auto';
    return () => { body.style.touchAction = prev; };
  }, []);

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

  function goSignIn() {
    setMenuOpen(false);
    setTab('signin');
    setErr(null);
    scrollToId('join');
  }

  return (
    <div
      id="top"
      className="min-h-[100dvh] flex flex-col font-sans text-ink"
      style={{
        backgroundColor: '#F3EDE0',
        backgroundImage:
          'radial-gradient(ellipse 70% 45% at 50% -10%, rgba(217,116,53,0.16), transparent 60%),' +
          'radial-gradient(ellipse 45% 30% at 88% 8%, rgba(232,184,48,0.12), transparent 70%),' +
          'radial-gradient(rgba(26,21,16,0.07) 1px, transparent 1px)',
        backgroundSize: 'auto, auto, 24px 24px',
      }}
    >
      {/* ── Top nav ─────────────────────────────────────────────── */}
      <header className="relative z-30 max-w-6xl w-full mx-auto px-5 sm:px-6 pt-5 flex items-center justify-between">
        <button onClick={() => scrollToId('top')} className="flex items-center" aria-label="Mypapr home">
          <Logo height={30} />
        </button>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1 text-sm">
          <button
            onClick={() => scrollToId('how')}
            className="px-3 py-2 text-ink/70 hover:text-ink rounded-lg"
          >How it works</button>
          <button
            onClick={goSignIn}
            className="ml-1 px-4 py-2 rounded-lg font-semibold border-2 border-ink/10 bg-paper hover:border-ink/20"
          >Sign in</button>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="sm:hidden w-10 h-10 -mr-1 rounded-lg flex items-center justify-center text-ink/70 hover:bg-ink/5"
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          )}
        </button>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div
            className="sm:hidden absolute right-5 top-full mt-2 w-52 rounded-2xl border border-ink/10 p-1.5 flex flex-col z-40"
            style={{ background: '#FDFAF5', boxShadow: '0 12px 32px rgba(26,21,16,0.14)' }}
          >
            <button
              onClick={() => { setMenuOpen(false); scrollToId('how'); }}
              className="text-left px-3 py-2.5 rounded-xl text-[14px] font-semibold text-ink/75 hover:bg-ink/5"
            >How it works</button>
            <button
              onClick={goSignIn}
              className="text-left px-3 py-2.5 rounded-xl text-[14px] font-semibold text-ink/75 hover:bg-ink/5"
            >Sign in</button>
          </div>
        )}
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <main className="flex-1 w-full">
        <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-8 sm:pt-14 pb-16 grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">
          {/* Left — story */}
          <div className="animate-fadeUp">
            <h1 className="text-[36px] sm:text-[50px] leading-[1.05] font-extrabold tracking-tight">
              Think out loud,{' '}
              <span style={{
                background: 'linear-gradient(120deg, #D97435, #E8B830)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>together.</span>
            </h1>
            <p className="mt-5 text-[16px] sm:text-[17px] text-ink/65 leading-relaxed max-w-[520px]">
              Mypapr is an infinite sheet of paper for sticky notes, sketches, images and
              docs. Drop a link, invite friends, and shape ideas together — no setup,
              no accounts required.
            </p>

            {/* How it works — quick bullets */}
            <ul id="how" className="mt-7 space-y-3 text-[15px] text-ink/75 scroll-mt-20">
              <Bullet n={1}>Name a room — the name becomes your shareable link</Bullet>
              <Bullet n={2}>Drop sticky notes, sketches, images, PDFs &amp; docs on the canvas</Bullet>
              <Bullet n={3}>Invite anyone — see live cursors and edit together</Bullet>
            </ul>
          </div>

          {/* Right — join / sign-in card */}
          <div id="join" className="animate-fadeUp scroll-mt-20">
            <div
              className="rounded-[24px] border border-ink/10 p-6 sm:p-7 max-w-[460px] w-full mx-auto"
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
        </section>
      </main>

      {/* ── Policy footer ───────────────────────────────────────── */}
      <footer className="border-t border-ink/10">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-ink/55">
          <div>© {new Date().getFullYear()} Mypapr</div>
          <nav className="flex items-center gap-5">
            <button onClick={() => scrollToId('how')} className="hover:text-ink">How it works</button>
            <a href="#" className="hover:text-ink">Privacy</a>
            <a href="#" className="hover:text-ink">Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// ── Small building blocks ──────────────────────────────────────────

// Brand mark. Loads the committed logo at /mypapr-logo.png and falls back to
// a text wordmark if it isn't present yet, so the page never shows a broken
// image. The art is white, so invert() flips it to dark on the light page.
function Logo({ height = 32 }: { height?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className="select-none"
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle: 'italic',
          fontWeight: 700,
          fontSize: Math.round(height * 0.82),
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: '#1A1510',
        }}
      >Mypapr</span>
    );
  }
  return (
    <img
      src="/mypapr-logo.png"
      alt="Mypapr"
      style={{ height, width: 'auto', objectFit: 'contain', filter: 'invert(1)' }}
      onError={() => setFailed(true)}
    />
  );
}

function Bullet({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-0.5 w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-[12px] font-extrabold"
        style={{ background: 'linear-gradient(140deg, #D97435, #E8B830)' }}
      >{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
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
