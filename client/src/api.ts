import type { Board, Room, BaseItem, Stroke } from './types';

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

  getBoard: (boardId: string) => req<Board>(`/api/boards/${boardId}`),

  saveBoard: (boardId: string, items: BaseItem[], strokes: Stroke[], name?: string) =>
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
};
