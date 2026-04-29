import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Board, BaseItem, BoardRefData, Stroke } from '../types';
import Canvas, { type CanvasHandle } from '../components/Canvas';
import Sidebar from '../components/Sidebar';
import Breadcrumbs from '../components/Breadcrumbs';
import DrawToolbar, { type Mode } from '../components/DrawToolbar';
import SettingsModal from '../components/SettingsModal';
import { useHistory } from '../hooks/useHistory';

interface Snap {
  items: BaseItem[];
  strokes: Stroke[];
  name: string;
}

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
  const [drawTool, setDrawTool] = useState<'pen' | 'fountain' | 'pencil' | 'marker' | 'brush'>('pen');
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
  const canvasRef = useRef<CanvasHandle>(null);

  // Combined snapshot for undo history. Recreated only when one of its
  // members actually changes, so the history hook doesn't see a new
  // identity on every unrelated render.
  const snap = useMemo<Snap>(() => ({ items, strokes, name }), [items, strokes, name]);
  const history = useHistory<Snap>(snap, (s) => {
    setItems(s.items);
    setStrokes(s.strokes);
    setName(s.name);
  });

  // Cmd/Ctrl + Z to undo, +Shift to redo. Skipped while typing in inputs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo(); else history.undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  // history.reset accessed via ref so load()'s identity is stable.
  const historyResetRef = useRef(history.reset);
  historyResetRef.current = history.reset;

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
      // Wipe undo history so the user can't undo across a load boundary.
      historyResetRef.current();
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
  // Sidebar passes a partial template; we drop it at the visible center.
  // Falls back to (0,0) on the very first render before the canvas mounts.
  function addItemAtCenter(template: Omit<BaseItem, 'x' | 'y'>) {
    const c = canvasRef.current?.getCenter() ?? { x: 0, y: 0 };
    addItem({
      ...template,
      x: c.x - template.w / 2,
      y: c.y - template.h / 2,
    } as BaseItem);
  }
  function updateItem(id: string, patch: Partial<BaseItem>) {
    setItems((xs) => xs.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function deleteItem(id: string) {
    setItems((xs) => xs.filter((it) => it.id !== id));
  }
  function deleteItems(ids: string[]) {
    const setIds = new Set(ids);
    setItems((xs) => xs.filter((it) => !setIds.has(it.id)));
  }
  // Translate every item whose id is in `ids` by (dx, dy).
  function moveItems(ids: string[], delta: { dx: number; dy: number }) {
    const setIds = new Set(ids);
    setItems((xs) =>
      xs.map((it) =>
        setIds.has(it.id) ? { ...it, x: it.x + delta.dx, y: it.y + delta.dy } : it
      )
    );
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
        onAdd={addItemAtCenter}
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
          tool={drawTool}
          penOnly={penOnly}
          onMode={setMode}
          onColor={setDrawColor}
          onWidth={setDrawWidth}
          onTool={setDrawTool}
          onPenOnly={togglePenOnly}
        />
        <Canvas
          ref={canvasRef}
          items={items}
          strokes={strokes}
          mode={mode}
          drawColor={drawColor}
          drawWidth={drawWidth}
          drawTool={drawTool}
          penOnly={penOnly}
          onUpdate={updateItem}
          onUpdateMany={moveItems}
          onDelete={deleteItem}
          onDeleteMany={deleteItems}
          onAdd={addItem}
          onSetStrokes={setStrokes}
          onEnterBoard={enterBoard}
        />
      </div>
    </div>
  );
}
