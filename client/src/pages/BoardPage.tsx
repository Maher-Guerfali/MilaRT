import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Board, BaseItem, BoardRefData } from '../types';
import Canvas from '../components/Canvas';
import Sidebar from '../components/Sidebar';
import Breadcrumbs from '../components/Breadcrumbs';

export default function BoardPage() {
  const { code, boardId } = useParams();
  const nav = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BaseItem[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true); setErr(null);
    try {
      let targetId = boardId;
      if (!targetId) {
        const room = await api.getRoom(code);
        nav(`/r/${room.code}/b/${room.rootBoardId}`, { replace: true });
        return;
      }
      const b = await api.getBoard(targetId);
      setBoard(b);
      setItems(b.items);
      setName(b.name);
      setLastSavedAt(new Date(b.updatedAt));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code, boardId, nav]);

  useEffect(() => { load(); }, [load]);

  // Debounced autosave. We snapshot items + name together so renames also save.
  const savedRef = useRef<string>('');
  useEffect(() => {
    if (!board) return;
    const snap = JSON.stringify({ items, name });
    const initial = JSON.stringify({ items: board.items, name: board.name });
    if (savedRef.current === '' && snap === initial) {
      savedRef.current = snap;
      return;
    }
    if (snap === savedRef.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const res = await api.saveBoard(board._id, items, name);
        savedRef.current = snap;
        setSaving('saved');
        setLastSavedAt(new Date(res.updatedAt));
      } catch {
        setSaving('error');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [items, name, board]);

  function addItem(item: BaseItem) {
    setItems((xs) => [...xs, { ...item, z: xs.length }]);
  }
  function updateItem(id: string, patch: Partial<BaseItem>) {
    setItems((xs) => xs.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function deleteItem(id: string) {
    setItems((xs) => xs.filter((it) => it.id !== id));
  }

  async function enterBoard(itemId: string) {
    if (!code || !board) return;
    const it = items.find((x) => x.id === itemId);
    if (!it || it.type !== 'board') return;
    const d = it.data as Partial<BoardRefData>;
    let bid = d.boardId;
    if (!bid) {
      const nested = await api.createNestedBoard(code, board._id, d.name || 'Untitled');
      bid = nested._id;
      const updated = items.map((x) =>
        x.id === itemId ? { ...x, data: { ...(x.data as object), boardId: bid } } : x
      );
      setItems(updated);
      // Persist immediately so the link survives even if the user navigates away fast.
      await api.saveBoard(board._id, updated, name);
      savedRef.current = JSON.stringify({ items: updated, name });
    }
    nav(`/r/${code}/b/${bid}`);
  }

  if (loading) return <div className="p-6 text-ink/60">Loading…</div>;
  if (err || !board) return <div className="p-6 text-red-600">Error: {err ?? 'not found'}</div>;

  return (
    <div className="h-full w-full flex">
      <Sidebar
        roomCode={code!}
        onAdd={addItem}
        onRefresh={load}
        saving={saving}
        lastSavedAt={lastSavedAt}
      />
      <div className="flex-1 relative overflow-hidden">
        <Breadcrumbs
          roomCode={code!}
          crumbs={board.breadcrumbs}
          currentName={name}
          onRename={setName}
        />
        <Canvas
          items={items}
          onUpdate={updateItem}
          onDelete={deleteItem}
          onAdd={addItem}
          onEnterBoard={enterBoard}
        />
      </div>
    </div>
  );
}
