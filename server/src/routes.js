import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { customAlphabet } from 'nanoid';
import potrace from 'potrace';
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

  // Read the room-wide Storage drawer.
  r.get('/rooms/:code/storage', async (req, res) => {
    const room = await findRoomByAnyCase(req.params.code);
    if (!room) return res.status(404).json({ error: 'not_found' });
    res.json({ storage: room.storage || [] });
  });

  // Replace the room-wide Storage drawer in one shot.
  // Body: { storage: BaseItem[] }
  r.put('/rooms/:code/storage', async (req, res) => {
    const room = await findRoomByAnyCase(req.params.code);
    if (!room) return res.status(404).json({ error: 'not_found' });
    const { storage } = req.body || {};
    if (!Array.isArray(storage)) return res.status(400).json({ error: 'invalid_storage' });
    room.storage = storage;
    await room.save();
    res.json({ ok: true, storage: room.storage });
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

  // ── AI assistant ───────────────────────────────────────────────────
  // POST /api/ai/chat
  // Body: { items: BaseItem[], prompt: string }
  // Returns: { operations: AIOperation[], explanation: string }
  r.post('/ai/chat', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI not configured — set OPENAI_API_KEY in your environment.' });
    }

    const { items, prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'missing prompt' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'missing items array' });
    }

    const systemMessage = `You are an AI assistant for a canvas board app called MilaRT.
The board contains items positioned in a 2D world (pixel coordinates). Each item has:
- id: unique string
- type: "sticky" | "image" | "link" | "board"
- x, y: top-left position in world pixels
- w, h: width and height in pixels
- z: layer index
- data: type-specific payload
  - sticky: { text: string, color: string (hex) }
  - image: { url: string }
  - link: { url: string, title: string }
  - board: { boardId: string, name: string }

When asked to perform operations call apply_board_operations with a list of operations.
Layout rules:
- "organise horizontally" — same y for all target items, equal x spacing, keep original sizes
- "organise in a grid" — arrange in rows/columns with even spacing
- "add titles/labels" — create sticky notes above each image item (type:"sticky", data.color:"#FDFAF5")
- "generate descriptions" — create sticky notes near items with helpful descriptive text
New item IDs must start with "ai-" followed by a short unique suffix.
Default sticky: w:200, h:80. Colors: yellow "#E8B830", white "#FDFAF5", orange "#D97435", blue "#dbeafe".
Return operations even if the request has no effect (empty array is valid).`;

    const textPart = {
      type: 'text',
      text: `Board items (${items.length} total):\n${JSON.stringify(items, null, 2)}\n\nUser request: ${prompt.trim()}`,
    };
    const contentParts = [textPart];

    // Attach up to 4 image URLs for vision when the prompt suggests content analysis
    const lp = prompt.toLowerCase();
    const wantsVision = /title|descri|label|caption|name|what|identif|recogni/.test(lp);
    if (wantsVision) {
      const imageItems = items
        .filter(it => it.type === 'image' && typeof it.data?.url === 'string' && /^https?:\/\//.test(it.data.url))
        .slice(0, 4);
      for (const img of imageItems) {
        contentParts.push({ type: 'image_url', image_url: { url: img.data.url, detail: 'low' } });
      }
    }

    const tools = [
      {
        type: 'function',
        function: {
          name: 'apply_board_operations',
          description: 'Apply a list of operations to the canvas board items',
          parameters: {
            type: 'object',
            properties: {
              operations: {
                type: 'array',
                description: 'Operations to execute in order',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['move', 'resize', 'update', 'add', 'delete'] },
                    id:   { type: 'string', description: 'Target item ID (move/resize/update/delete)' },
                    x:    { type: 'number' },
                    y:    { type: 'number' },
                    w:    { type: 'number' },
                    h:    { type: 'number' },
                    data: { type: 'object', description: 'Partial data fields to merge (update)' },
                    item: { type: 'object', description: 'Full new item object (add)' },
                  },
                  required: ['type'],
                },
              },
              explanation: { type: 'string', description: 'One sentence summary of what was done' },
            },
            required: ['operations', 'explanation'],
          },
        },
      },
    ];

    try {
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user',   content: contentParts },
          ],
          tools,
          tool_choice: { type: 'function', function: { name: 'apply_board_operations' } },
          max_tokens: 3000,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        console.error('[ai] OpenAI error:', aiRes.status, errText);
        return res.status(502).json({ error: `OpenAI error ${aiRes.status}`, detail: errText.slice(0, 300) });
      }

      const aiData = await aiRes.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        return res.status(502).json({ error: 'AI returned no operations' });
      }

      const result = JSON.parse(toolCall.function.arguments);
      res.json({
        operations: Array.isArray(result.operations) ? result.operations : [],
        explanation: typeof result.explanation === 'string' ? result.explanation : '',
      });
    } catch (err) {
      console.error('[ai] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI whiteboard / paper scan ────────────────────────────────────
  // POST /api/ai/whiteboard-scan
  // Body: { imageDataUrl: string }   // base64 data: URL of the photo
  // Returns: { blocks: ScanBlock[], explanation: string, photo: { w, h } }
  //
  // ScanBlock = {
  //   kind: 'sticky' | 'text',
  //   text: string,
  //   color: string | null,         // hex, only when kind === 'sticky'
  //   bbox: { x, y, w, h }          // normalized 0..1 (origin top-left)
  // }
  //
  // The client maps these normalized boxes into world coordinates centred
  // on the current viewport, preserving the spatial layout of the photo.
  r.post('/ai/whiteboard-scan', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI not configured — set OPENAI_API_KEY in your environment.' });
    }

    const { imageDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'missing imageDataUrl (expected a data: URL)' });
    }

    const systemMessage = `You are a vision assistant that converts a photograph of a real-world whiteboard, sketchbook, or sticky-note wall into structured digital blocks for a Milanote-style canvas.

Identify every distinct piece of written content in the photo and return it as a "block". Each block must have:
- kind: "sticky" if the content sits on a coloured square sticky-note background; otherwise "text" (free handwriting, titles, lists, anything not on a sticky).
- text: the full transcribed content of that block. Preserve line breaks with \\n. Be a careful OCR — handwriting is often messy. If unsure of a word, give your best guess. Do NOT add commentary, headers, or bullet markers that aren't in the source.
- color: only for kind="sticky" — pick the closest of these hex colours to the actual sticky colour: yellow "#FFF3C4", pink "#FFDEDE", green "#D4F0DE", blue "#E0EDFF", purple "#F0E4FF". For text blocks set color to null.
- bbox: tight axis-aligned bounding box of the block in NORMALIZED coordinates relative to the full image, where (0,0) is the top-left and (1,1) is the bottom-right. Provide x, y, w, h all in [0,1]. Boxes may overlap slightly but should each enclose a single coherent block.

Rules:
- Do NOT merge separate sticky notes. Each sticky is its own block.
- Group continuous handwriting that clearly belongs together (e.g. a numbered list) into ONE text block, but split obviously separate sections.
- Skip pure decoration (arrows, scribbles, doodles with no readable content). It's fine to return zero blocks.
- Do NOT invent content that isn't in the photo.
- Keep "explanation" to a single short sentence describing what you saw.

Return via the return_whiteboard_scan tool.`;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'return_whiteboard_scan',
          description: 'Return the structured transcription of the whiteboard photo.',
          parameters: {
            type: 'object',
            properties: {
              explanation: { type: 'string' },
              blocks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['sticky', 'text'] },
                    text: { type: 'string' },
                    color: { type: ['string', 'null'] },
                    bbox: {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        w: { type: 'number' },
                        h: { type: 'number' },
                      },
                      required: ['x', 'y', 'w', 'h'],
                    },
                  },
                  required: ['kind', 'text', 'bbox'],
                },
              },
            },
            required: ['explanation', 'blocks'],
          },
        },
      },
    ];

    try {
      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemMessage },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Transcribe this whiteboard photo into structured blocks.' },
                { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
              ],
            },
          ],
          tools,
          tool_choice: { type: 'function', function: { name: 'return_whiteboard_scan' } },
          max_tokens: 4000,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        console.error('[ai/whiteboard-scan] OpenAI error:', aiRes.status, errText.slice(0, 300));
        return res.status(502).json({ error: `OpenAI error ${aiRes.status}`, detail: errText.slice(0, 300) });
      }

      const aiData = await aiRes.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        return res.status(502).json({ error: 'AI returned no scan' });
      }

      const result = JSON.parse(toolCall.function.arguments);
      const blocks = Array.isArray(result.blocks) ? result.blocks : [];
      console.log(`[ai/whiteboard-scan] ${blocks.length} blocks`);
      res.json({
        blocks,
        explanation: typeof result.explanation === 'string' ? result.explanation : '',
      });
    } catch (err) {
      console.error('[ai/whiteboard-scan] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI whiteboard trace (handwriting → editable strokes) ──────────
  // POST /api/ai/whiteboard-trace
  // Body: { regions: [{ dataUrl: string }, ...] }   // PNG crops, one per block
  // Returns: { traces: [{ index: number, polylines: number[][] }] }
  // polylines are arrays of [x0,y0,x1,y1,...] in the region's own px coords.
  // The client maps them onto the board the same way it maps scan blocks.
  r.post('/ai/whiteboard-trace', async (req, res) => {
    const { regions } = req.body || {};
    if (!Array.isArray(regions) || regions.length === 0) {
      return res.status(400).json({ error: 'missing regions' });
    }
    if (regions.length > 60) {
      return res.status(400).json({ error: 'too many regions (max 60)' });
    }

    try {
      const traces = [];
      // Sequential — potrace is CPU-bound and parallel runs would just queue.
      for (let i = 0; i < regions.length; i++) {
        const r0 = regions[i];
        const dataUrl = r0?.dataUrl;
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
        const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
        if (!m) continue;
        const buf = Buffer.from(m[1], 'base64');
        const svg = await traceBuffer(buf);
        const polylines = svgPathsToPolylines(svg);
        if (polylines.length) traces.push({ index: i, polylines });
      }
      res.json({ traces });
    } catch (err) {
      console.error('[ai/whiteboard-trace] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI whiteboard cleanup (gpt-image-1 redraw) ────────────────────
  // POST /api/ai/whiteboard-clean
  // Body: { imageDataUrl: string, aspect?: number }   // aspect = w/h
  // Returns: { dataUrl: string }   // gpt-image-1 redrawn PNG, base64 data URL
  //
  // Sends the photo to gpt-image-1 with a "redraw cleanly, same layout, same
  // ink colors, white background" prompt. The returned image is then traced
  // by the client using the existing whiteboard-trace endpoint.
  r.post('/ai/whiteboard-clean', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI not configured — set OPENAI_API_KEY in your environment.' });
    }
    const { imageDataUrl, aspect } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'missing imageDataUrl' });
    }
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: 'invalid imageDataUrl' });
    const imageBuffer = Buffer.from(match[2], 'base64');

    // Pick the gpt-image-1 size whose aspect matches the input most closely.
    const a = Number(aspect) || 1;
    const size = a > 1.2 ? '1536x1024' : a < 0.83 ? '1024x1536' : '1024x1024';

    const prompt =
      'Redraw this photo of a whiteboard, sticky-note wall, or notebook page as a perfectly clean version. ' +
      'Reproduce every piece of handwriting and every drawing in the exact same layout and the same ink colours as the original. ' +
      'Make all lines crisp and clearly readable. ' +
      'The output must have a pure white background with no shadows, no glare, no paper texture — only the writing and drawings on white. ' +
      'Do not add, remove, rearrange, or stylise any content.';

    try {
      const formData = new FormData();
      formData.append('model', 'gpt-image-1');
      formData.append('prompt', prompt);
      formData.append('n', '1');
      formData.append('size', size);
      formData.append('quality', 'medium');
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('image', blob, 'image.png');

      const aiRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        console.error('[ai/whiteboard-clean] OpenAI error:', aiRes.status, errText.slice(0, 300));
        return res.status(502).json({ error: `OpenAI error ${aiRes.status}`, detail: errText.slice(0, 300) });
      }

      const aiData = await aiRes.json();
      const b64 = aiData?.data?.[0]?.b64_json;
      if (!b64) return res.status(502).json({ error: 'No image in AI response' });

      console.log(`[ai/whiteboard-clean] done size=${size} bytes=${b64.length}`);
      res.json({ dataUrl: `data:image/png;base64,${b64}` });
    } catch (err) {
      console.error('[ai/whiteboard-clean] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI image editing (image-to-image) ─────────────────────────────
  // POST /api/ai/image-edit
  // Body: { imageDataUrl: string (base64 PNG), prompt: string }
  // Returns: { url: string } — a newly uploaded image URL
  r.post('/ai/image-edit', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI not configured — set OPENAI_API_KEY in your environment.' });
    }
    const { imageDataUrl, prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'missing prompt' });
    if (!imageDataUrl || typeof imageDataUrl !== 'string') return res.status(400).json({ error: 'missing imageDataUrl' });

    // Strip data URL prefix and decode to buffer
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: 'invalid imageDataUrl' });
    const [, , b64] = match;
    const imageBuffer = Buffer.from(b64, 'base64');

    try {
      // Build multipart form for OpenAI /v1/images/edits
      const { FormData, Blob } = await import('node:buffer').then(() => globalThis);
      const formData = new FormData();
      formData.append('model', 'gpt-image-1');
      formData.append('prompt', prompt.trim().slice(0, 1000));
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      // image field must be a File/Blob with a .png filename
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('image', blob, 'image.png');

      const aiRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => '');
        console.error('[ai/image-edit] OpenAI error:', aiRes.status, errText.slice(0, 300));
        return res.status(502).json({ error: `OpenAI error ${aiRes.status}`, detail: errText.slice(0, 300) });
      }

      const aiData = await aiRes.json();
      // gpt-image-1 returns b64_json by default
      const b64Result = aiData?.data?.[0]?.b64_json;
      const urlResult = aiData?.data?.[0]?.url;

      let resultBuffer, resultMime = 'image/png';
      if (b64Result) {
        resultBuffer = Buffer.from(b64Result, 'base64');
      } else if (urlResult) {
        // Fetch the URL and re-upload
        const imgRes = await fetch(urlResult);
        resultBuffer = Buffer.from(await imgRes.arrayBuffer());
        resultMime = imgRes.headers.get('content-type') || 'image/png';
      } else {
        return res.status(502).json({ error: 'No image in AI response' });
      }

      // Upload to our storage (Supabase or local disk)
      const filename = `ai-edit-${Date.now()}.png`;
      const { url } = await storageUpload({ buffer: resultBuffer, filename, mimetype: resultMime, localDir: uploadDir });
      console.log(`[ai/image-edit] done -> ${url}`);
      res.json({ url });
    } catch (err) {
      console.error('[ai/image-edit] error:', err);
      res.status(500).json({ error: err.message });
    }
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

// ── potrace helpers (used by /api/ai/whiteboard-trace) ────────────────

function traceBuffer(buf) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      buf,
      {
        threshold: -1,        // auto Otsu
        turdSize: 2,          // drop tiny speckles
        alphaMax: 1.0,
        optCurve: true,
        optTolerance: 0.4,
        color: 'black',
        background: 'transparent',
      },
      (err, svg) => (err ? reject(err) : resolve(svg)),
    );
  });
}

// Extract every <path d="..."> attribute from a potrace SVG, then flatten
// each path's M / L / C / Z commands to polylines. Cubic Beziers are sampled
// at 6 segments — enough to look smooth, not enough to bloat the payload.
function svgPathsToPolylines(svg) {
  if (typeof svg !== 'string') return [];
  const out = [];
  const re = /<path\b[^>]*\sd="([^"]+)"/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    for (const poly of flattenPathD(m[1], 6)) {
      if (poly.length >= 4) out.push(poly);
    }
  }
  return out;
}

function flattenPathD(d, segments) {
  const tokens = d.match(/[MLCHVZmlchvz]|-?\d+(?:\.\d+)?/g) || [];
  const polylines = [];
  let cur = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let i = 0;
  function pushCur() {
    if (cur.length >= 4) polylines.push(cur);
    cur = [];
  }
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === 'M' || c === 'm') {
      const x = +tokens[i++], y = +tokens[i++];
      pushCur();
      if (c === 'm') { cx += x; cy += y; } else { cx = x; cy = y; }
      sx = cx; sy = cy;
      cur.push(cx, cy);
      // Subsequent coord pairs after M are implicit L
      while (i < tokens.length && /^-?\d/.test(tokens[i])) {
        const lx = +tokens[i++], ly = +tokens[i++];
        if (c === 'm') { cx += lx; cy += ly; } else { cx = lx; cy = ly; }
        cur.push(cx, cy);
      }
    } else if (c === 'L' || c === 'l') {
      while (i < tokens.length && /^-?\d/.test(tokens[i])) {
        const x = +tokens[i++], y = +tokens[i++];
        if (c === 'l') { cx += x; cy += y; } else { cx = x; cy = y; }
        cur.push(cx, cy);
      }
    } else if (c === 'H' || c === 'h') {
      while (i < tokens.length && /^-?\d/.test(tokens[i])) {
        const x = +tokens[i++];
        if (c === 'h') cx += x; else cx = x;
        cur.push(cx, cy);
      }
    } else if (c === 'V' || c === 'v') {
      while (i < tokens.length && /^-?\d/.test(tokens[i])) {
        const y = +tokens[i++];
        if (c === 'v') cy += y; else cy = y;
        cur.push(cx, cy);
      }
    } else if (c === 'C' || c === 'c') {
      while (i < tokens.length && /^-?\d/.test(tokens[i])) {
        const x1 = +tokens[i++], y1 = +tokens[i++];
        const x2 = +tokens[i++], y2 = +tokens[i++];
        const x  = +tokens[i++], y  = +tokens[i++];
        const ax1 = c === 'c' ? cx + x1 : x1;
        const ay1 = c === 'c' ? cy + y1 : y1;
        const ax2 = c === 'c' ? cx + x2 : x2;
        const ay2 = c === 'c' ? cy + y2 : y2;
        const ax  = c === 'c' ? cx + x  : x;
        const ay  = c === 'c' ? cy + y  : y;
        for (let s = 1; s <= segments; s++) {
          const t = s / segments;
          const u = 1 - t;
          const px = u*u*u*cx + 3*u*u*t*ax1 + 3*u*t*t*ax2 + t*t*t*ax;
          const py = u*u*u*cy + 3*u*u*t*ay1 + 3*u*t*t*ay2 + t*t*t*ay;
          cur.push(px, py);
        }
        cx = ax; cy = ay;
      }
    } else if (c === 'Z' || c === 'z') {
      cur.push(sx, sy);
      pushCur();
      cx = sx; cy = sy;
    }
  }
  pushCur();
  return polylines;
}
