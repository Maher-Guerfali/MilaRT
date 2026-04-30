import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { customAlphabet } from 'nanoid';
import { Room, Board, Feedback } from './models.js';
import { uploadImage as storageUpload, STORAGE_MODE } from './storage.js';

// ── Helpers shared by export / import routes ───────────────────────────

/**
 * For each image item whose data.url is a base64 data: URL, decode and
 * upload to storage; replace url with the resulting server URL.
 * Non-image items and items with regular URLs are returned unchanged.
 */
async function processItemImages(items, uploadDir) {
  if (!Array.isArray(items)) return [];
  return Promise.all(items.map(async (item) => {
    if (item.type !== 'image') return item;
    const url = item.data?.url;
    if (typeof url !== 'string' || !url.startsWith('data:')) return item;
    const match = url.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return item;
    const [, mimetype, b64] = match;
    try {
      const buffer = Buffer.from(b64, 'base64');
      const ext = (mimetype.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { url: serverUrl } = await storageUpload({ buffer, filename, mimetype, localDir: uploadDir });
      // Strip the data: URL, keep _originalUrl provenance if present
      const { url: _removed, ...restData } = item.data;
      return { ...item, data: { ...restData, url: serverUrl } };
    } catch (e) {
      console.warn('[import] image upload failed, keeping data-URL:', e.message);
      return item;
    }
  }));
}

/**
 * Topological sort so parents always appear before their children.
 * Handles cycles / orphan boards gracefully.
 */
function topologicalSortBoards(boards) {
  const byId = new Map(boards.map(b => [b.id, b]));
  const result = [];
  const visited = new Set();
  function visit(b) {
    if (visited.has(b.id)) return;
    if (b.parentBoardId && byId.has(b.parentBoardId)) visit(byId.get(b.parentBoardId));
    visited.add(b.id);
    result.push(b);
  }
  boards.forEach(visit);
  return result;
}

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
  // Always ensure a local upload dir exists — even in Supabase mode the
  // /uploads/* static route stays mounted so old image URLs from before
  // the migration still resolve.
  fs.mkdirSync(uploadDir, { recursive: true });

  // Multer keeps the file in memory; the storage layer decides whether to
  // ship it to Supabase or write it to disk.
  const upload = multer({
    storage: multer.memoryStorage(),
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

  // Save a board (full replace of items/strokes + optional name).
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
  // Stores in Supabase Storage when configured; otherwise on local disk.
  r.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const ext = path.extname(req.file.originalname || '').toLowerCase().slice(0, 8) || '.png';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    try {
      const { url } = await storageUpload({
        buffer: req.file.buffer,
        filename,
        mimetype: req.file.mimetype || 'image/png',
        localDir: uploadDir,
      });
      console.log(`[upload] mode=${STORAGE_MODE} -> ${url}`);
      res.json({ url });
    } catch (err) {
      console.error('[upload] failed:', err);
      res.status(500).json({ error: 'upload_failed', detail: err.message });
    }
  });

  // Save user feedback text into the database.
  r.post('/feedback', async (req, res) => {
    const text = (req.body?.text || '').toString().trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'empty_feedback' });
    await Feedback.create({ text });
    console.log(`[feedback] saved (${text.length} chars)`);
    res.json({ ok: true });
  });

  // ── Export / Import ────────────────────────────────────────────────

  // GET /api/rooms/:code/export
  // Returns a complete v2 room snapshot (all boards, items, strokes).
  // Image URLs are NOT embedded here — the browser client does that with
  // fetch+FileReader before writing the local file, keeping this endpoint fast.
  r.get('/rooms/:code/export', async (req, res) => {
    try {
      const room = await findRoomByAnyCase(req.params.code);
      if (!room) return res.status(404).json({ error: 'not_found' });
      const boards = await Board.find({ roomId: room._id }).lean();
      res.json({
        $schema: 'milart/v2',
        version: 2,
        type: 'milart-room',
        exportedAt: new Date().toISOString(),
        room: { code: room.code, name: room.name, rootBoardId: String(room.rootBoardId) },
        boards: boards.map(b => ({
          id: String(b._id),
          name: b.name,
          parentBoardId: b.parentBoardId ? String(b.parentBoardId) : null,
          items: b.items || [],
          strokes: b.strokes || [],
        })),
      });
    } catch (err) {
      console.error('[export]', err);
      res.status(500).json({ error: 'export_failed', detail: err.message });
    }
  });

  // POST /api/rooms/:code/import
  // Replaces the room with a v2 snapshot.  Handles embedded base64 images
  // (uploads them to storage first, stores server URLs).
  // Also remaps all board-type item boardId references to new MongoDB IDs.
  r.post('/rooms/:code/import', async (req, res) => {
    try {
      const payload = req.body;
      if (
        payload?.version !== 2 ||
        payload?.type !== 'milart-room' ||
        !Array.isArray(payload?.boards)
      ) {
        return res.status(400).json({
          error: 'invalid_payload',
          detail: 'Expected { version: 2, type: "milart-room", boards: [...] }',
        });
      }
      const room = await findRoomByAnyCase(req.params.code);
      if (!room) return res.status(404).json({ error: 'not_found' });

      // Wipe existing boards for this room
      await Board.deleteMany({ roomId: room._id });

      const idMap = new Map(); // oldId (string) → newId (string)
      const sorted = topologicalSortBoards(payload.boards);
      const created = [];

      for (const b of sorted) {
        const newParentId = b.parentBoardId ? idMap.get(b.parentBoardId) : null;
        const processedItems = await processItemImages(b.items || [], uploadDir);
        const newBoard = await Board.create({
          roomId: room._id,
          parentBoardId: newParentId || null,
          name: (String(b.name || '')).slice(0, 80) || 'Untitled',
          items: processedItems,
          strokes: b.strokes || [],
        });
        idMap.set(b.id, String(newBoard._id));
        created.push(newBoard);
      }

      // Fix board-type item references (data.boardId) to use new MongoDB IDs
      for (const newBoard of created) {
        const plain = newBoard.toObject();
        let changed = false;
        const updatedItems = plain.items.map(item => {
          if (item.type === 'board' && item.data?.boardId) {
            const remapped = idMap.get(item.data.boardId);
            if (remapped) { changed = true; return { ...item, data: { ...item.data, boardId: remapped } }; }
          }
          return item;
        });
        if (changed) await Board.findByIdAndUpdate(newBoard._id, { items: updatedItems });
      }

      // Update room root pointer
      const newRootId = idMap.get(String(payload.room?.rootBoardId)) || [...idMap.values()][0];
      if (newRootId) { room.rootBoardId = newRootId; await room.save(); }

      console.log(`[import] room=${room.code} boards=${created.length}`);
      res.json({ ok: true, rootBoardId: newRootId || String(room.rootBoardId), boardCount: created.length });
    } catch (err) {
      console.error('[import]', err);
      res.status(500).json({ error: 'import_failed', detail: err.message });
    }
  });

  // ── Per-item AI / MCP endpoints ───────────────────────────────────
  // These allow fine-grained board manipulation so an AI agent can add,
  // edit, or remove individual items without replacing the whole board.

  // POST /api/boards/:id/items — add a single item
  r.post('/boards/:id/items', async (req, res) => {
    try {
      const board = await Board.findById(req.params.id);
      if (!board) return res.status(404).json({ error: 'not_found' });
      const item = req.body;
      if (!item?.id || !item?.type) {
        return res.status(400).json({ error: 'invalid_item', detail: 'item.id and item.type are required' });
      }
      if (board.items.some(it => it.id === item.id)) {
        return res.status(409).json({ error: 'duplicate_id', detail: `Item with id "${item.id}" already exists` });
      }
      const [processed] = await processItemImages([item], uploadDir);
      board.items.push(processed);
      await board.save();
      res.status(201).json({ ok: true, item: processed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/boards/:id/items/:itemId — partial update of one item
  // Merges top-level fields and deep-merges the data object.
  r.patch('/boards/:id/items/:itemId', async (req, res) => {
    try {
      const board = await Board.findById(req.params.id);
      if (!board) return res.status(404).json({ error: 'not_found' });
      const idx = board.items.findIndex(it => it.id === req.params.itemId);
      if (idx < 0) return res.status(404).json({ error: 'item_not_found' });
      const patch = req.body || {};
      const current = board.items[idx].toObject();
      const merged = {
        ...current,
        ...patch,
        id: current.id,                                                    // id is immutable
        data: patch.data ? { ...current.data, ...patch.data } : current.data,
      };
      const [processed] = await processItemImages([merged], uploadDir);
      board.items.set(idx, processed);
      await board.save();
      res.json({ ok: true, item: processed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/boards/:id/items/:itemId — remove one item
  r.delete('/boards/:id/items/:itemId', async (req, res) => {
    try {
      const board = await Board.findByIdAndUpdate(
        req.params.id,
        { $pull: { items: { id: req.params.itemId } } },
        { new: true },
      );
      if (!board) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/boards/:id/strokes — append one or more strokes
  // Body: { strokes: [{color, width, tool?, points:[x,y,p,...]}] }
  r.post('/boards/:id/strokes', async (req, res) => {
    try {
      const strokes = Array.isArray(req.body?.strokes) ? req.body.strokes : [req.body];
      if (!strokes.length || !Array.isArray(strokes[0]?.points)) {
        return res.status(400).json({
          error: 'invalid_strokes',
          detail: 'Provide { strokes: [{ color, width, points: [x, y, pressure, ...] }] }',
        });
      }
      const board = await Board.findByIdAndUpdate(
        req.params.id,
        { $push: { strokes: { $each: strokes } } },
        { new: true },
      );
      if (!board) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true, strokeCount: board.strokes.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/boards/:id/strokes — clear all strokes on a board
  r.delete('/boards/:id/strokes', async (req, res) => {
    try {
      const board = await Board.findByIdAndUpdate(req.params.id, { strokes: [] }, { new: true });
      if (!board) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
