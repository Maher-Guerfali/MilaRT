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
  return `${a}${b}${Math.floor(Math.random() * 90 + 10)}`.toLowerCase();
}

function smoothScrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  // Pre-fill a random display name on open. It's shown greyed-out so people
  // can tell it's auto-generated and editable; the grey lifts once they type.
  const [name, setName] = useState<string>(existing?.name ?? randomName());
  const [nameTouched, setNameTouched] = useState<boolean>(!!existing?.name);

  // Room name the user is about to create — drives the confirmation popup.
  const [pendingCreate, setPendingCreate] = useState<string | null>(null);

  // ── Sign-in state ─────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const trimmedRoom = room.trim();

  function persistIdentity() {
    const n = (name.trim() || randomName()).toLowerCase();
    saveIdentity(n);
  }

  // Join an existing room. If the room doesn't exist yet, instead of silently
  // creating it (which led to spammy throwaway rooms), pop a confirmation so
  // the user explicitly opts in to creating a new one.
  async function handleJoin() {
    if (!trimmedRoom) { setErr('Insert a room name first.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.getRoom(trimmedRoom);
      persistIdentity();
      nav(`/r/${r.code}`);
    } catch {
      setPendingCreate(trimmedRoom);
    } finally { setBusy(false); }
  }

  // "Create" button: same confirmation flow. If the name is already taken we
  // route the user to Join instead of creating a duplicate.
  async function handleCreate() {
    if (!trimmedRoom) { setErr('Insert a room name first.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.getRoom(trimmedRoom);
      // Already exists — just join it, no new room spawned.
      persistIdentity();
      nav(`/r/${r.code}`);
    } catch {
      setPendingCreate(trimmedRoom);
    } finally { setBusy(false); }
  }

  // Actually create the room after the user confirms the popup.
  async function confirmCreate() {
    const target = pendingCreate;
    if (!target) return;
    setPendingCreate(null);
    setBusy(true); setErr(null);
    try {
      const r = await api.createRoom(target);
      persistIdentity();
      nav(`/r/${r.code}`);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('409') || msg.includes('name_taken')) {
        setErr(`"${target}" was just taken — try Join instead.`);
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
      className="min-h-screen font-sans text-ink"
      style={{
        background:
          'radial-gradient(ellipse 70% 40% at 50% -10%, rgba(217,116,53,0.18), transparent 60%),' +
          'radial-gradient(ellipse 40% 30% at 90% 10%, rgba(232,184,48,0.14), transparent 70%),' +
          '#F3EDE0',
      }}
    >
      {/* ── Top nav ─────────────────────────────────────────────── */}
      <header className="max-w-6xl mx-auto px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold text-lg"
            style={{
              background: 'linear-gradient(140deg, #D97435, #E8B830)',
              boxShadow: '0 6px 16px rgba(217,116,53,0.45)',
            }}
          >M</div>
          <span className="text-[17px] font-extrabold tracking-tight">MaherBoard</span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <a
            href="#how"
            onClick={(e) => { e.preventDefault(); smoothScrollTo('how'); }}
            className="hidden sm:inline-block px-3 py-2 text-ink/70 hover:text-ink rounded-lg"
          >How it works</a>
          <a
            href="#features"
            onClick={(e) => { e.preventDefault(); smoothScrollTo('features'); }}
            className="hidden sm:inline-block px-3 py-2 text-ink/70 hover:text-ink rounded-lg"
          >Features</a>
          <button
            onClick={() => { setTab('signin'); document.getElementById('join')?.scrollIntoView({ behavior: 'smooth' }); }}
            className="px-4 py-2 rounded-lg font-semibold border-2 border-ink/10 bg-paper hover:border-ink/20"
          >Sign in</button>
        </nav>
      </header>

      {/* ── Hero + Join card ────────────────────────────────────── */}
      <section id="join" className="max-w-6xl mx-auto px-6 pt-10 sm:pt-16 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <div className="animate-fadeUp">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-paper border border-ink/10 text-[12px] font-semibold text-ink/70 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />
            Real-time visual boards
          </div>
          <h1 className="text-[40px] sm:text-[52px] leading-[1.05] font-extrabold tracking-tight">
            Think out loud,{' '}
            <span style={{
              background: 'linear-gradient(120deg, #D97435, #E8B830)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>together.</span>
          </h1>
          <p className="mt-5 text-[17px] text-ink/65 leading-relaxed max-w-[520px]">
            An infinite canvas for sticky notes, sketches, images and docs. Drop a link,
            invite friends, sketch ideas live — no setup, no accounts required.
          </p>
          <ul className="mt-7 space-y-2.5 text-[15px] text-ink/75">
            <FeatureLi>Create a room and share the URL — anyone with the link can join</FeatureLi>
            <FeatureLi>Sticky notes, drawings, images, scanned docs, nested boards</FeatureLi>
            <FeatureLi>Live cursors and presence so you see who's editing what</FeatureLi>
          </ul>
        </div>

        {/* ── Auth card ───────────────────────────────────────── */}
        <div className="animate-fadeUp">
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

            {/* Room name (shared by both tabs) — lowercase only, it becomes the URL. */}
            <Field label="Room name">
              <input
                autoFocus
                value={room}
                onChange={(e) => setRoom(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tab === 'quick') {
                    if (e.shiftKey) handleCreate(); else handleJoin();
                  }
                }}
                placeholder="insert room name"
                maxLength={30}
                className="w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors lowercase"
              />
            </Field>

            {tab === 'quick' ? (
              <>
                <Field label="Your display name">
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value.toLowerCase()); setNameTouched(true); }}
                    onFocus={(e) => { if (!nameTouched) e.currentTarget.select(); }}
                    maxLength={24}
                    placeholder="what should we call you?"
                    className={`w-full px-4 py-[12px] rounded-xl text-[15px] bg-cream border-2 border-ink/10 focus:border-amber outline-none transition-colors lowercase ${
                      nameTouched ? 'text-ink' : 'text-ink/40 italic'
                    }`}
                  />
                  {!nameTouched && (
                    <p className="text-[11px] text-ink/45 mt-1.5 leading-snug">
                      We picked a random name — tap to edit it.
                    </p>
                  )}
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
                <p className="text-[11px] text-ink/55 mt-3 leading-snug">
                  No account needed. The room name <em>is</em> the link your friends use — pick one,
                  then <strong>Join</strong> an existing room or <strong>Create</strong> a new one.
                  We'll confirm before making a brand-new room.
                </p>
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

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-14 sm:py-20">
        <h2 className="text-[28px] sm:text-[34px] font-extrabold tracking-tight text-center">How it works</h2>
        <p className="text-ink/60 text-center mt-2 max-w-[520px] mx-auto">
          Three steps from blank page to a room buzzing with sketches and ideas.
        </p>
        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          <Step n={1} title="Name a room" body="Pick anything — your name becomes the URL. Share it with anyone." />
          <Step n={2} title="Drop ideas" body="Drag sticky notes, sketches, images, PDFs, or paste links onto the canvas." />
          <Step n={3} title="Collaborate live" body="See cursors, edit together, branch into nested boards as ideas grow." />
        </div>
      </section>

      {/* ── Feature grid ─────────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Feature title="Infinite canvas" body="Pan, zoom, and pile in as much as you want — performance stays smooth." />
          <Feature title="Live presence" body="Cursors, names and colours show who's there and what they're touching." />
          <Feature title="Sketch & scan" body="Draw freehand, or snap a whiteboard photo and turn it into editable strokes." />
          <Feature title="AI assist" body="Ask the assistant to clean up notes, lay out blocks, or rewrite text in place." />
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-ink/10">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-ink/55">
          <div>© {new Date().getFullYear()} MaherBoard — a visual thinking space.</div>
          <div className="flex items-center gap-4">
            <a href="#how" onClick={(e) => { e.preventDefault(); smoothScrollTo('how'); }} className="hover:text-ink">How it works</a>
            <a href="#features" onClick={(e) => { e.preventDefault(); smoothScrollTo('features'); }} className="hover:text-ink">Features</a>
          </div>
        </div>
      </footer>

      {/* Create-room confirmation — friction against accidental throwaway rooms. */}
      {pendingCreate && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          style={{ background: 'rgba(26,21,16,0.45)', backdropFilter: 'blur(3px)' }}
          onClick={() => setPendingCreate(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[400px] rounded-[22px] border border-ink/10 p-6 animate-fadeUp"
            style={{ background: '#FDFAF5', boxShadow: '0 24px 60px rgba(26,21,16,0.22)' }}
          >
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-[20px] font-extrabold mb-4"
              style={{ background: 'linear-gradient(140deg, #D97435, #E8B830)' }}
            >+</div>
            <h3 className="text-[19px] font-extrabold tracking-tight">Create a new room?</h3>
            <p className="mt-2 text-[14px] text-ink/65 leading-relaxed">
              No room called <span className="font-bold text-ink">"{pendingCreate}"</span> exists yet.
              You're about to create a brand-new one. Proceed?
            </p>
            <div className="flex gap-2.5 mt-5">
              <button
                onClick={confirmCreate}
                disabled={busy}
                className="flex-1 py-[12px] rounded-xl text-white font-bold text-[15px] disabled:opacity-50 transition-transform active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, #D97435, #F08848)',
                  boxShadow: '0 3px 16px rgba(217,116,53,0.40)',
                }}
              >Create room →</button>
              <button
                onClick={() => setPendingCreate(null)}
                disabled={busy}
                className="px-5 py-[12px] rounded-xl text-ink font-semibold text-[14px] disabled:opacity-50 border-2 border-ink/10 bg-paper hover:border-ink/20"
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small building blocks ──────────────────────────────────────────

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

function FeatureLi({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #D97435, #E8B830)' }}
      />
      <span>{children}</span>
    </li>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div
      className="rounded-2xl border border-ink/10 p-5"
      style={{ background: '#FDFAF5' }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-[15px] mb-3"
        style={{ background: 'linear-gradient(140deg, #D97435, #E8B830)' }}
      >{n}</div>
      <h3 className="font-bold text-[16px]">{title}</h3>
      <p className="text-[13px] text-ink/60 mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 p-4 bg-paper/60 hover:bg-paper transition-colors">
      <h3 className="font-bold text-[14px]">{title}</h3>
      <p className="text-[12.5px] text-ink/60 mt-1 leading-relaxed">{body}</p>
    </div>
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
