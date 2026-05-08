// Persistent anonymous identity for live presence.
//
// Stored in localStorage so the same person keeps the same colour across
// rooms and sessions. No login, no server-side account. The id is just a
// random handle used to dedupe peers — no PII attached.

import { nanoid } from 'nanoid';

const KEY = 'milart.identity.v1';

export interface Identity {
  id: string;
  name: string;
  color: string;
}

// 12 saturated-but-paper-friendly colours. Picked to be distinct on the
// #F3EDE0 board background.
const PALETTE = [
  '#D97435', // amber
  '#3B7DD9', // blue
  '#2EA86A', // green
  '#C73E6C', // pink
  '#7A4FE0', // purple
  '#0EA5A8', // teal
  '#E8A317', // gold
  '#5C7AE0', // indigo
  '#D14B4B', // red
  '#5BA12F', // olive
  '#7E5A3B', // brown
  '#C03BAE', // magenta
];

// Deterministic colour from a stable id — same person, same colour every visit.
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (!parsed.id || !parsed.name) return null;
    return {
      id: parsed.id,
      name: parsed.name.slice(0, 24),
      color: parsed.color && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
        ? parsed.color
        : colorFor(parsed.id),
    };
  } catch {
    return null;
  }
}

export function saveIdentity(name: string): Identity {
  const trimmed = name.trim().slice(0, 24) || 'Anonymous';
  // Reuse existing id if present so the user keeps their colour after rename.
  const existing = loadIdentity();
  const id = existing?.id ?? nanoid(12);
  const identity: Identity = { id, name: trimmed, color: colorFor(id) };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* storage blocked — identity is still valid for this session */
  }
  return identity;
}
