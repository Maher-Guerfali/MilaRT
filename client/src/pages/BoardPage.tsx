import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Board, BaseItem, BoardRefData, Stroke } from '../types';
import Canvas from '../components/Canvas';
import Sidebar from '../components/Sidebar';
import Breadcrumbs from '../components/Breadcrumbs';
import DrawToolbar, { type Mode } from '../components/DrawToolbar';
import SettingsModal from '../components/SettingsModal';

export default function BoardPage() {
  const { code, boardId } = useParams();
  const nav = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [items, setItems] = useState<BaseItem[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [mode, setMode] = useState<Mode>('drag');
  const [drawColor, setDrawColor] = useState('#1b1b1b');
  const [drawWidth, setDrawWidth] = useState(2);
  // Persist pen-only across sessions on the same device — most users will
  // either always be on iPad with a pencil or never.
  const [penOnly, setPenOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('milart.penOnly') === '1'; } catch { return false; }
  });
  function togglePenOnly(v: boolean) {
    setPenOnly(v);
    try { localStorage.setItem('milart.penOnly', v ? '1' : '0'); } catch { /* ignore */ }
  }

  const [settingsOpen, setSettingsOpen] = useState(false);

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
      setStrokes(b.strokes || []);
      setName(b.name);
      setLastSavedAt(new Date(b.updatedAt));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code, boardId, nav]);

  useEffect(() => { load(); }, [load]);

  const savedRef = useRef<string>('');
  useEffect(() => {
    if (!board) return;
    const snap = JSON.stringify({ items, strokes, name });
    const initial = JSON.stringify({ items: board.items, strokes: board.strokes || [], name: board.name });
    if (savedRef.current === '' && snap === initial) {
      savedRef.current = snap;
      return;
    }
    if (snap === savedRef.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const res = await api.saveBoard(board._id, items, strokes, name);
        savedRef.current = snap;
        setSaving('saved');
        setLastSavedAt(new Date(res.updatedAt));
      } catch {
        setSaving('error');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [items, strokes, name, board]);

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
      await api.saveBoard(board._id, updated, strokes, name);
      savedRef.current = JSON.stringify({ items: updated, strokes, name });
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
        onOpenSettings={() => setSettingsOpen(true)}
        saving={saving}
        lastSavedAt={lastSavedAt}
      />
      <SettingsModal
        open={settingsOpen}
        roomCode={code!}
        boardName={name}
        items={items}
        strokes={strokes}
        onClose={() => setSettingsOpen(false)}
        onImport={(p) => {
          setItems(p.items);
          setStrokes(p.strokes);
          setName(p.name);
          setSettingsOpen(false);
        }}
      />
      <div className="flex-1 relative overflow-hidden">
        <Breadcrumbs
          roomCode={code!}
          crumbs={board.breadcrumbs}
          currentName={name}
          onRename={setName}
        />
        <DrawToolbar
          mode={mode}
          color={drawColor}
          width={drawWidth}
          penOnly={penOnly}
          onMode={setMode}
          onColor={setDrawColor}
          onWidth={setDrawWidth}
          onPenOnly={togglePenOnly}
          onClear={() => setStrokes([])}
        />
        <Canvas
          items={items}
          strokes={strokes}
          mode={mode}
          drawColor={drawColor}
          drawWidth={drawWidth}
          penOnly={penOnly}
          onUpdate={updateItem}
          onDelete={deleteItem}
          onAdd={addItem}
          onSetStrokes={setStrokes}
          onEnterBoard={enterBoard}
        />
      </div>
    </div>
  );
}
