import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { customAlphabet } from 'nanoid';
import { Room, Board } from './models.js';

// Fallback random code if the user creates a room without picking a name.
const RANDOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
const makeRandomCode = customAlphabet(RANDOM_ALPHABET, 6);

// Turn a free-text room name into a URL-safe, lowercase slug.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

// Case-insensitive room lookup so old random codes (uppercase) and new
// user-named slugs (lowercase) both resolve.
async function findRoomByAnyCase(raw) {
  const t = (raw || '').trim();
  if (!t) return null;
  return Room.findOne({ code: { $in: [t, t.toLowerCase(), t.toUpperCase()] } });
}

export function makeRoutes({ uploadDir }) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8) || '.png';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
      cb(null, true);
    },
  });

  const r = Router();

  // Create a new room. The user-supplied name is BOTH the human display
  // name (kept as-typed) AND the slugified room code (lowercase, URL-safe).
  // If no name is given, fall back to a 6-char random slug.
  r.post('/rooms', async (req, res) => {
    const rawName = (req.body?.name || '').toString().slice(0, 80);
    let code = slugify(rawName);
    if (!code) {
      // No name -> generate a random one and retry on the off chance of collision.
      for (let i = 0; i < 5; i++) {
        const candidate = makeRandomCode();
        if (!(await Room.exists({ code: candidate }))) { code = candidate; break; }
      }
    }
    if (!code || code.length < 2) return res.status(400).json({ error: 'name_too_short' });

    if (await findRoomByAnyCase(code)) {
      return res.status(409).json({ error: 'name_taken', code });
    }

    const displayName = rawName || code;
    const room = await Room.create({ code, name: displayName });
    const board = await Board.create({ roomId: room._id, parentBoardId: null, name: 'Home' });
    room.rootBoardId = board._id;
    await room.save();
    res.json({ code: room.code, name: room.name, rootBoardId: board._id });
  });

  // Look up a room by its code (case-insensitive).
  r.get('/rooms/:code', async (req, res) => {
    const room = await findRoomByAnyCase(req.params.code);
    if (!room) return res.status(404).json({ error: 'not_found' });
    res.json({
      code: room.code,
      name: room.name,
      rootBoardId: room.rootBoardId,
    });
  });

  // Delete a room and every board (and its items + strokes) that belongs to it.
  // Anyone with the room code can do this — same trust model as editing.
  r.delete('/rooms/:code', async (req, res) => {
    const room = await findRoomByAnyCase(req.params.code);
    if (!room) return res.status(404).json({ error: 'not_found' });
    await Board.deleteMany({ roomId: room._id });
    await Room.deleteOne({ _id: room._id });
    res.json({ deleted: true, code: room.code });
  });

  // Create a nested board inside an existing one.
  r.post('/boards', async (req, res) => {
    const { roomCode, parentBoardId, name } = req.body || {};
    const room = await findRoomByAnyCase(roomCode);
    if (!room) return res.status(404).json({ error: 'room_not_found' });
    const parent = await Board.findOne({ _id: parentBoardId, roomId: room._id });
    if (!parent) return res.status(404).json({ error: 'parent_not_found' });
    const board = await Board.create({
      roomId: room._id,
      parentBoardId: parent._id,
      name: (name || 'Untitled board').slice(0, 80),
    });
    res.json({ _id: board._id, name: board.name });
  });

  // Read a single board with its items and minimal breadcrumb.
  r.get('/boards/:id', async (req, res) => {
    const board = await Board.findById(req.params.id);
    if (!board) return res.status(404).json({ error: 'not_found' });

    const crumbs = [];
    let cur = board;
    while (cur) {
      crumbs.unshift({ _id: cur._id, name: cur.name });
      if (!cur.parentBoardId) break;
      cur = await Board.findById(cur.parentBoardId);
    }

    res.json({
      _id: board._id,
      roomId: board.roomId,
      parentBoardId: board.parentBoardId,
      name: board.name,
      items: board.items,
      strokes: board.strokes || [],
      updatedAt: board.updatedAt,
      breadcrumbs: crumbs,
    });
  });

  // Save a board (full replace of items/strokes + optional name). Autosave target.
  r.put('/boards/:id', async (req, res) => {
    const { items, strokes, name } = req.body || {};
    const update = {};
    if (Array.isArray(items)) update.items = items;
    if (Array.isArray(strokes)) update.strokes = strokes;
    if (typeof name === 'string') update.name = name.slice(0, 80);
    const board = await Board.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!board) return res.status(404).json({ error: 'not_found' });
    res.json({ _id: board._id, updatedAt: board.updatedAt });
  });

  // Upload an image; returns a public URL the client can drop into an item.
  r.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    // Sanity check — confirm the file actually landed where we'll serve it from.
    const written = path.join(uploadDir, req.file.filename);
    const exists = fs.existsSync(written);
    console.log('[upload]', written, exists ? 'OK' : 'MISSING');
    if (!exists) return res.status(500).json({ error: 'upload_lost', uploadDir, written });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  return r;
}
