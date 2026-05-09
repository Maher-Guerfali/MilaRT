import type { Board, Room, BaseItem, Stroke, RoomExportV2, AIOperation } from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

export const api = {
  createRoom: (name?: string) =>
    req<Room>('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }),

  getRoom: (code: string) => req<Room>(`/api/rooms/${encodeURIComponent(code)}`),

  getRoomStorage: (code: string) =>
    req<{ storage: BaseItem[] }>(`/api/rooms/${encodeURIComponent(code)}/storage`),

  saveRoomStorage: (code: string, storage: BaseItem[]) =>
    req<{ ok: true; storage: BaseItem[] }>(`/api/rooms/${encodeURIComponent(code)}/storage`, {
      method: 'PUT',
      body: JSON.stringify({ storage }),
    }),

  deleteRoom: (code: string) =>
    req<{ deleted: true; code: string }>(`/api/rooms/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  getBoard: (boardId: string) => req<Board>(`/api/boards/${boardId}`),

  saveBoard: (
    boardId: string,
    items: BaseItem[],
    strokes: Stroke[],
    name?: string,
  ) =>
    req<{ _id: string; updatedAt: string }>(`/api/boards/${boardId}`, {
      method: 'PUT',
      body: JSON.stringify({ items, strokes, name }),
    }),

  createNestedBoard: (roomCode: string, parentBoardId: string, name?: string) =>
    req<{ _id: string; name: string }>(`/api/boards`, {
      method: 'POST',
      body: JSON.stringify({ roomCode, parentBoardId, name }),
    }),

  uploadImage: async (file: File | Blob): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return res.json();
  },

  sendFeedback: (text: string) =>
    req<{ ok: true }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // ── Export / Import ────────────────────────────────────────────────

  /** Fetch full room snapshot from server (no embedded images — client embeds them). */
  exportRoom: (code: string) =>
    req<RoomExportV2>(`/api/rooms/${encodeURIComponent(code)}/export`),

  /** Replace all boards in a room with a v2 snapshot (images may be base64 — server re-uploads). */
  importRoom: (code: string, payload: RoomExportV2) =>
    req<{ ok: true; rootBoardId: string; boardCount: number }>(
      `/api/rooms/${encodeURIComponent(code)}/import`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // ── Per-item AI / MCP endpoints ────────────────────────────────────

  /** Add a single item to a board. */
  addItem: (boardId: string, item: BaseItem) =>
    req<{ ok: true; item: BaseItem }>(`/api/boards/${boardId}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  /** Partially update one item (top-level fields + deep-merge data). */
  updateItem: (boardId: string, itemId: string, patch: Partial<BaseItem>) =>
    req<{ ok: true; item: BaseItem }>(
      `/api/boards/${boardId}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  /** Remove one item from a board. */
  deleteItem: (boardId: string, itemId: string) =>
    req<{ ok: true }>(
      `/api/boards/${boardId}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    ),

  /** Append one or more strokes to a board. */
  addStrokes: (boardId: string, strokes: Stroke[]) =>
    req<{ ok: true; strokeCount: number }>(`/api/boards/${boardId}/strokes`, {
      method: 'POST',
      body: JSON.stringify({ strokes }),
    }),

  /** Clear all strokes on a board. */
  clearStrokes: (boardId: string) =>
    req<{ ok: true }>(`/api/boards/${boardId}/strokes`, { method: 'DELETE' }),

  // ── AI assistant ───────────────────────────────────────────────────

  /** Send a natural-language prompt + current items to the AI.
   *  Returns a list of structured operations + a human-readable explanation. */
  aiChat: (items: BaseItem[], prompt: string) =>
    req<{ operations: AIOperation[]; explanation: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ items, prompt }),
    }),

  /** Image-to-image edit: send a PNG data URL + prompt, get back an edited image URL. */
  aiImageEdit: (imageDataUrl: string, prompt: string) =>
    req<{ url: string }>('/api/ai/image-edit', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl, prompt }),
    }),

  /** Trace cropped block images into editable polylines (one per ink shape).
   *  Coords are pixels in each region's own crop space — the client maps
   *  them back to world coords. */
  aiWhiteboardTrace: (regions: { dataUrl: string }[]) =>
    req<{ traces: Array<{ index: number; polylines: number[][] }> }>(
      '/api/ai/whiteboard-trace',
      { method: 'POST', body: JSON.stringify({ regions }) },
    ),

  /** Vision-scan a whiteboard / paper photo. Returns normalized blocks the
   *  client maps onto the canvas at the current viewport centre. */
  aiWhiteboardScan: (imageDataUrl: string) =>
    req<{
      blocks: Array<{
        kind: 'sticky' | 'text';
        text: string;
        color: string | null;
        bbox: { x: number; y: number; w: number; h: number };
      }>;
      explanation: string;
    }>('/api/ai/whiteboard-scan', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    }),
};
