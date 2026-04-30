import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Board, BaseItem, BoardRefData, Stroke } from '../types';
import Canvas, { type CanvasHandle } from '../components/Canvas';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import CanvasDock from '../components/CanvasDock';
import DrawTray, { type DrawTool, type SizeKey } from '../components/DrawTray';
import SettingsModal from '../components/SettingsModal';
import TutorialModal from '../components/TutorialModal';
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
  const [, setLastSavedAt] = useState<Date | null>(null);

  const [isMove, setIsMove] = useState(true);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>('pencil');
  const [drawColor, setDrawColor] = useState('#1a1510');
  const [penSize, setPenSize] = useState<SizeKey>('md');
  const [eraserSize, setEraserSize] = useState<SizeKey>('md');

  const [penOnly, setPenOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('milart.penOnly') === '1'; } catch { return false; }
  });

  function togglePenOnly(v: boolean) {
    setPenOnly(v);
    try { localStorage.setItem('milart.penOnly', v ? '1' : '0'); } catch { /* ignore */ }
  }

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const canvasRef = useRef<CanvasHandle>(null);

  const snap = useMemo<Snap>(
    () => ({ items, strokes, name }),
    [items, strokes, name],
  );
  const history = useHistory<Snap>(snap, (s) => {
    setItems(s.items);
    setStrokes(s.strokes);
    setName(s.name);
  });

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

  // Show tutorial on very first visit
  useEffect(() => {
    try {
      if (!localStorage.getItem('milart.tutorialSeen')) {
        setTutorialOpen(true);
      }
    } catch { /* storage blocked */ }
  }, []);

  const savedRef = useRef<string>('');
  useEffect(() => {
    if (!board) return;
    const s = JSON.stringify({ items, strokes, name });
    const initial = JSON.stringify({
      items: board.items,
      strokes: board.strokes || [],
      name: board.name,
    });
    if (savedRef.current === '' && s === initial) {
      savedRef.current = s;
      return;
    }
    if (s === savedRef.current) return;
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const res = await api.saveBoard(board._id, items, strokes, name);
        savedRef.current = s;
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
  function addItemAtCenter(template: Omit<BaseItem, 'x' | 'y'>) {
    const c = canvasRef.current?.getCenter() ?? { x: 0, y: 0 };
    addItem({ ...template, x: c.x - template.w / 2, y: c.y - template.h / 2 } as BaseItem);
  }
  // Use functional setState so rapid successive strokes don't overwrite each other
  function addStroke(s: import('../types').Stroke) {
    setStrokes((prev) => [...prev, s]);
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
  function moveItems(ids: string[], delta: { dx: number; dy: number }) {
    const setIds = new Set(ids);
    setItems((xs) =>
      xs.map((it) =>
        setIds.has(it.id) ? { ...it, x: it.x + delta.dx, y: it.y + delta.dy } : it
      )
    );
  }
  // Items are rendered in array order. Bringing forward = move toward end.
  function moveLayer(id: string, dir: 'forward' | 'backward') {
    setItems((xs) => {
      const idx = xs.findIndex((it) => it.id === id);
      if (idx < 0) return xs;
      const swapWith = dir === 'forward' ? idx + 1 : idx - 1;
      if (swapWith < 0 || swapWith >= xs.length) return xs;
      const next = xs.slice();
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
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

  function toggleDraw() {
    setDrawOpen((o) => {
      const next = !o;
      if (next) setIsMove(false); else setIsMove(true);
      return next;
    });
  }
  function activateMove() {
    setIsMove(true);
    setDrawOpen(false);
  }
  // Spring-load: hold Draw button → temporary move/pan mode
  function onDrawHoldStart() {
    setIsMove(true);
    setDrawOpen(false);
  }
  // On release → restore draw mode
  function onDrawHoldEnd() {
    setIsMove(false);
    setDrawOpen(true);
  }

  if (loading) return <div className="p-6 text-ink/50">Loading…</div>;
  if (err || !board) return <div className="p-6 text-red-600">Error: {err ?? 'not found'}</div>;

  return (
    <div className="h-full w-full flex" style={{ background: '#F3EDE0' }}>
      {tutorialOpen && (
        <TutorialModal onClose={() => {
          setTutorialOpen(false);
          try { localStorage.setItem('milart.tutorialSeen', '1'); } catch { /* ignore */ }
        }} />
      )}
      <Sidebar
        roomCode={code!}
        onAdd={addItemAtCenter}
        onRefresh={load}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
        saving={saving}
        isDrawMode={!isMove && drawOpen}
        onActivateMove={activateMove}
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
        onRoomImportSuccess={(rootBoardId) => {
          setSettingsOpen(false);
          nav(`/r/${code}/b/${rootBoardId}`);
        }}
      />

      <div className="flex-1 relative overflow-hidden">
        <TopBar
          roomCode={code!}
          crumbs={board.breadcrumbs}
          currentName={name}
          saving={saving}
          onRename={setName}
        />

        <Canvas
          ref={canvasRef}
          items={items}
          strokes={strokes}
          isMove={isMove}
          drawOpen={drawOpen}
          drawTool={drawTool}
          drawColor={drawColor}
          penSize={penSize}
          eraserSize={eraserSize}
          penOnly={penOnly}
          onUpdate={updateItem}
          onUpdateMany={moveItems}
          onDelete={deleteItem}
          onDeleteMany={deleteItems}
          onAdd={addItem}
          onSetStrokes={setStrokes}
          onAddStroke={addStroke}
          onMoveLayer={moveLayer}
          onEnterBoard={enterBoard}
        />

        <CanvasDock
          isMove={isMove}
          drawOpen={drawOpen}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onMove={activateMove}
          onDraw={toggleDraw}
          onUndo={history.undo}
          onRedo={history.redo}
          onDrawHoldStart={onDrawHoldStart}
          onDrawHoldEnd={onDrawHoldEnd}
        />

        <DrawTray
          open={drawOpen}
          drawTool={drawTool}
          penColor={drawColor}
          penSize={penSize}
          eraserSize={eraserSize}
          penOnly={penOnly}
          onToolChange={setDrawTool}
          onColorChange={setDrawColor}
          onPenSizeChange={setPenSize}
          onEraserSizeChange={setEraserSize}
          onPenOnlyChange={togglePenOnly}
          onClose={() => { setDrawOpen(false); setIsMove(true); }}
        />
      </div>
    </div>
  );
}
