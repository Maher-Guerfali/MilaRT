import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { customAlphabet } from 'nanoid';
import { Room, Board } from './models.js';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const makeRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 6);

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'server/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
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

export function makeRoutes() {
  const r = Router();

  // Create a new room + its root board.
  r.post('/rooms', async (req, res) => {
    const name = (req.body?.name || '').toString().slice(0, 80) || 'My room';
    // Retry a few times in the astronomically unlikely event of a code collision.
    for (let i = 0; i < 5; i++) {
      const code = makeRoomCode();
      const exists = await Room.exists({ code });
      if (exists) continue;
      const room = await Room.create({ code, name });
      const board = await Board.create({
        roomId: room._id,
        parentBoardId: null,
        name: 'Home',
      });
      room.rootBoardId = board._id;
      await room.save();
      return res.json({
        code: room.code,
        name: room.name,
        rootBoardId: board._id,
      });
    }
    res.status(500).json({ error: 'could_not_allocate_code' });
  });

  // Look up a room by its code.
  r.get('/rooms/:code', async (req, res) => {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });
    if (!room) return res.status(404).json({ error: 'not_found' });
    res.json({
      code: room.code,
      name: room.name,
      rootBoardId: room.rootBoardId,
    });
  });

  // Create a nested board inside an existing one.
  r.post('/boards', async (req, res) => {
    const { roomCode, parentBoardId, name } = req.body || {};
    const room = await Room.findOne({ code: (roomCode || '').toUpperCase() });
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
      updatedAt: board.updatedAt,
      breadcrumbs: crumbs,
    });
  });

  // Save a board (full replace of items + optional name). Autosave target.
  r.put('/boards/:id', async (req, res) => {
    const { items, name } = req.body || {};
    const update = {};
    if (Array.isArray(items)) update.items = items;
    if (typeof name === 'string') update.name = name.slice(0, 80);
    const board = await Board.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!board) return res.status(404).json({ error: 'not_found' });
    res.json({ _id: board._id, updatedAt: board.updatedAt });
  });

  // Upload an image; returns a public URL the client can drop into an item.
  r.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  return r;
}
