import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { api } from '../api';
import type { Board, BaseItem, BoardRefData, Stroke, AIOperation } from '../types';
import Canvas, { type CanvasHandle } from '../components/Canvas';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import CanvasDock from '../components/CanvasDock';
import DrawTray, { type DrawTool, type SizeKey } from '../components/DrawTray';
import SettingsModal from '../components/SettingsModal';
import TutorialModal from '../components/TutorialModal';
import AIPreviewModal from '../components/AIPreviewModal';
import CameraScanModal from '../components/CameraScanModal';
import IdentityPromptModal from '../components/IdentityPromptModal';
import StoragePanel from '../components/StoragePanel';
import DocumentEditor from '../components/DocumentEditor';
import DrawPaper from '../components/DrawPaper';
import { useHistory } from '../hooks/useHistory';
import { usePresence } from '../hooks/usePresence';
import { loadIdentity, saveIdentity, type Identity } from '../lib/identity';

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
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
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
  const [cameraScanOpen, setCameraScanOpen] = useState(false);

  // ── Live presence (other people's cursors in this room) ────────────
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const { peers, sendCursor } = usePresence(code, identity);
  const canvasRef = useRef<CanvasHandle>(null);

  const [freshItemId, setFreshItemId] = useState<string | null>(null);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function markFreshItem(id: string) {
    if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    setFreshItemId(id);
    freshTimerRef.current = setTimeout(() => setFreshItemId(null), 8000);
  }
  function clearFreshItem() {
    if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    setFreshItemId(null);
  }

  // ── AI assistant state ─────────────────────────────────────────────
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<{
    explanation: string;
    operations: AIOperation[];
  } | null>(null);

  async function handleAISubmit(prompt: string) {
    setAiLoading(true);
    try {
      const result = await api.aiChat(items, prompt);
      setAiPreview(result);
    } catch (e) {
      alert(`AI error: ${(e as Error).message}`);
    } finally {
      setAiLoading(false);
    }
  }

  function applyAIOperations(ops: AIOperation[]) {
    setItems((prev) => {
      let next = [...prev];
      for (const op of ops) {
        if (op.type === 'move' && op.id) {
          next = next.map((it) =>
            it.id === op.id ? { ...it, x: op.x ?? it.x, y: op.y ?? it.y } : it,
          );
        } else if (op.type === 'resize' && op.id) {
          next = next.map((it) =>
            it.id === op.id ? { ...it, w: op.w ?? it.w, h: op.h ?? it.h } : it,
          );
        } else if (op.type === 'update' && op.id && op.data) {
          next = next.map((it) =>
            it.id === op.id ? { ...it, data: { ...(it.data as object), ...op.data } } : it,
          );
        } else if (op.type === 'add' && op.item) {
          next = [...next, { ...op.item, z: next.length }];
        } else if (op.type === 'delete' && op.id) {
          next = next.filter((it) => it.id !== op.id);
        }
      }
      return next;
    });
  }

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

  // Auto-fit all items into view when a board first loads.
  // Uses a ref to prevent re-triggering on incremental item edits.
  const autoFitBoardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!board || items.length === 0) return;
    const boardKey = board._id;
    if (autoFitBoardRef.current === boardKey) return;
    autoFitBoardRef.current = boardKey;
    // Give Canvas one frame to mount and measure its viewport size.
    const t = setTimeout(() => {
      canvasRef.current?.focusOnIds(items.map((it) => it.id), { fit: 0.80, duration: 0 });
    }, 80);
    return () => clearTimeout(t);
  }, [board, items]);

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

  async function handleExport(fmt: 'png' | 'json') {
    if (fmt === 'png') {
      try {
        const dataUrl = await canvasRef.current?.captureViewport();
        if (!dataUrl) { alert('Could not capture canvas.'); return; }
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `board-${code || 'export'}.png`;
        a.click();
      } catch {
        alert('PNG export failed — try JSON instead.');
      }
    } else {
      const data = JSON.stringify({ items, strokes }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `board-${code || 'export'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function addItem(item: BaseItem) {
    setItems((xs) => [...xs, { ...item, z: xs.length }]);
    markFreshItem(item.id);
  }

  function copyImageToStorage(url: string) {
    const id = nanoid(10);
    const storedItem: BaseItem = {
      id, type: 'image', x: 0, y: 0, w: 218, h: 148, z: 0,
      data: { url, label: 'AI generated' },
    };
    setStoredItems((s) => [storedItem, ...s]);
  }

  function createBoardWithCover(imageUrl: string) {
    const id = nanoid(10);
    addItemAtCenter({
      id, type: 'board', w: 118, h: 155, z: 0,
      data: { name: 'New board', imageUrl },
    });
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

  // ── Storage (room-level, shared across boards) ─────────────────────
  const [storedItems, setStoredItems] = useState<BaseItem[]>([]);

  // Load room storage once we have a room code.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api.getRoomStorage(code).then((res) => {
      if (!cancelled) setStoredItems(res.storage || []);
    }).catch(() => { /* ignore — empty drawer */ });
    return () => { cancelled = true; };
  }, [code]);

  // Debounce-save room storage whenever it changes (after the initial load).
  const storageInitialRef = useRef(true);
  useEffect(() => {
    if (!code) return;
    if (storageInitialRef.current) { storageInitialRef.current = false; return; }
    const t = setTimeout(() => {
      api.saveRoomStorage(code, storedItems).catch(() => { /* ignore */ });
    }, 600);
    return () => clearTimeout(t);
  }, [storedItems, code]);

  async function sendToStorage(id: string) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const data = { ...(it.data as Record<string, unknown>) };
    delete data.stored;

    // For board items: snapshot the board's content so it can be fully restored later.
    if (it.type === 'board' && code) {
      const boardId = (it.data as Partial<BoardRefData>).boardId;
      if (boardId) {
        try {
          const boardData = await api.getBoard(boardId);
          data.boardSnapshot = {
            items: boardData.items,
            strokes: boardData.strokes || [],
            name: boardData.name,
          };
        } catch { /* store without snapshot if fetch fails */ }
      }
    }

    const portable: BaseItem = { ...it, data };
    setItems((xs) => xs.filter((x) => x.id !== id));
    setStoredItems((s) => [portable, ...s.filter((p) => p.id !== id)]);
  }

  // cx,cy is the world position the item should be centred on.
  async function restoreFromStorageAt(id: string, cx: number, cy: number) {
    const it = storedItems.find((p) => p.id === id);
    if (!it) return;

    // Board items: create a fresh board on the server, populate with the stored snapshot.
    if (it.type === 'board' && code && board) {
      const d = it.data as Partial<BoardRefData> & { boardSnapshot?: { items: BaseItem[]; strokes: Stroke[]; name: string } };
      try {
        const nested = await api.createNestedBoard(code, board._id, d.name || 'Untitled');
        if (d.boardSnapshot?.items?.length) {
          await api.saveBoard(nested._id, d.boardSnapshot.items, d.boardSnapshot.strokes || [], d.boardSnapshot.name || d.name || 'Untitled');
        }
        const newData: Record<string, unknown> = { ...(d as Record<string, unknown>), boardId: nested._id };
        delete newData.boardSnapshot;
        const restoredItem: BaseItem = {
          ...it,
          id: nanoid(10),
          data: newData,
          x: cx - it.w / 2,
          y: cy - it.h / 2,
          z: items.length,
        };
        setStoredItems((s) => s.filter((p) => p.id !== id));
        setItems((xs) => [...xs, restoredItem]);
      } catch (e) {
        alert('Could not restore board: ' + (e as Error).message);
      }
      return;
    }

    setStoredItems((s) => s.filter((p) => p.id !== id));
    setItems((xs) => [
      ...xs,
      { ...it, x: cx - it.w / 2, y: cy - it.h / 2, z: xs.length },
    ]);
  }
  function restoreFromStorageCenter(id: string) {
    const c = canvasRef.current?.getCenter() ?? { x: 0, y: 0 };
    void restoreFromStorageAt(id, c.x, c.y);
  }
  function deleteFromStorage(id: string) {
    setStoredItems((s) => s.filter((p) => p.id !== id));
  }
  // Drag-merge: stitch the source's text under the target's existing text
  // and remove the source. Works between sticky ↔ link/text in any pair.
  function mergeItems(srcId: string, targetId: string) {
    if (srcId === targetId) return;
    setItems((xs) => {
      const src = xs.find((x) => x.id === srcId);
      const target = xs.find((x) => x.id === targetId);
      if (!src || !target) return xs;
      const getText = (it: BaseItem): string => {
        const dt = it.data as { text?: string; title?: string; url?: string };
        if (it.type === 'sticky') return dt.text ?? '';
        if (it.type === 'link') return (dt.title || dt.url || '').toString();
        return '';
      };
      const srcText = getText(src);
      const targetText = getText(target);
      const merged = targetText && srcText
        ? `${targetText}\n${srcText}`
        : (srcText || targetText);
      return xs
        .filter((x) => x.id !== srcId)
        .map((x) => {
          if (x.id !== targetId) return x;
          if (x.type === 'sticky') {
            return { ...x, data: { ...x.data, text: merged } };
          }
          if (x.type === 'link') {
            // Once merged the item becomes plain text — clear the URL so the
            // renderer no longer treats it as a link/embed.
            return { ...x, data: { ...x.data, title: merged, url: '' } };
          }
          return x;
        });
    });
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

  // Right-click → "Export here" on a board component.
  // Fetches the nested board's items + strokes, then drops them onto the
  // current canvas with their bbox centred on the board component.
  async function exportBoardHere(itemId: string) {
    const it = items.find((x) => x.id === itemId);
    if (!it || it.type !== 'board') return;
    const d = it.data as Partial<BoardRefData>;
    if (!d.boardId) {
      alert('This board is empty — open it first to create its contents.');
      return;
    }
    let child: Board;
    try {
      child = await api.getBoard(d.boardId);
    } catch (e) {
      alert(`Could not load board: ${(e as Error).message}`);
      return;
    }
    const childItems = child.items || [];
    const childStrokes = child.strokes || [];
    if (childItems.length === 0 && childStrokes.length === 0) return;

    // Bounding box of the child's contents (items + strokes).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of childItems) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    }
    for (const s of childStrokes) {
      for (let i = 0; i < s.points.length; i += 3) {
        const px = s.points[i], py = s.points[i + 1];
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

    const childCX = (minX + maxX) / 2;
    const childCY = (minY + maxY) / 2;
    const targetCX = it.x + it.w / 2;
    const targetCY = it.y + it.h / 2;
    const dx = targetCX - childCX;
    const dy = targetCY - childCY;

    setItems((xs) => {
      const baseZ = xs.length;
      const added: BaseItem[] = childItems.map((c, i) => ({
        ...c,
        // Fresh ids so the cloned items don't collide with anything (including
        // sibling nested boards that all share the same imported children).
        id: nanoid(10),
        x: c.x + dx,
        y: c.y + dy,
        z: baseZ + i,
      }));
      return [...xs, ...added];
    });
    if (childStrokes.length) {
      setStrokes((prev) => [
        ...prev,
        ...childStrokes.map((s) => ({
          ...s,
          points: s.points.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)),
        })),
      ]);
    }
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

  // Move dragged items into the nested board referenced by `boardItemId`.
  // Creates the nested board on demand (mirrors enterBoard), then writes
  // the source items into it and removes them from the current board.
  async function dropIntoBoard(srcIds: string[], boardItemId: string) {
    if (!code || !board) return;
    const targetItem = items.find((x) => x.id === boardItemId);
    if (!targetItem || targetItem.type !== 'board') return;
    const sources = items.filter((x) => srcIds.includes(x.id));
    if (sources.length === 0) return;

    const d = targetItem.data as Partial<BoardRefData>;
    let bid = d.boardId;
    let updatedItems = items;
    if (!bid) {
      const nested = await api.createNestedBoard(code, board._id, d.name || 'Untitled');
      bid = nested._id;
      updatedItems = items.map((x) =>
        x.id === boardItemId ? { ...x, data: { ...(x.data as object), boardId: bid } } : x
      );
    }

    // Re-centre dropped items around the middle of the target board.
    const targetCenter = {
      x: targetItem.x + targetItem.w / 2,
      y: targetItem.y + targetItem.h / 2,
    };
    let srcMinX = Infinity, srcMinY = Infinity, srcMaxX = -Infinity, srcMaxY = -Infinity;
    for (const s of sources) {
      if (s.x < srcMinX) srcMinX = s.x;
      if (s.y < srcMinY) srcMinY = s.y;
      if (s.x + s.w > srcMaxX) srcMaxX = s.x + s.w;
      if (s.y + s.h > srcMaxY) srcMaxY = s.y + s.h;
    }
    const srcCenterX = (srcMinX + srcMaxX) / 2;
    const srcCenterY = (srcMinY + srcMaxY) / 2;
    const dx = targetCenter.x - srcCenterX;
    const dy = targetCenter.y - srcCenterY;
    const movedSources = sources.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));

    const nested = await api.getBoard(bid);
    const nestedItems = [...nested.items, ...movedSources];
    await api.saveBoard(bid, nestedItems, nested.strokes || []);

    const remaining = updatedItems.filter((x) => !srcIds.includes(x.id));
    setItems(remaining);
    await api.saveBoard(board._id, remaining, strokes, name);
    savedRef.current = JSON.stringify({ items: remaining, strokes, name });
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
      {!identity && (
        <IdentityPromptModal onSubmit={(name) => setIdentity(saveIdentity(name))} />
      )}
      {tutorialOpen && (
        <TutorialModal onClose={() => {
          setTutorialOpen(false);
          try { localStorage.setItem('milart.tutorialSeen', '1'); } catch { /* ignore */ }
        }} />
      )}
      {aiPreview && (
        <AIPreviewModal
          explanation={aiPreview.explanation}
          operations={aiPreview.operations}
          items={items}
          onApply={() => {
            applyAIOperations(aiPreview.operations);
            setAiPreview(null);
          }}
          onDiscard={() => setAiPreview(null)}
        />
      )}
      <Sidebar
        roomCode={code!}
        onAdd={addItemAtCenter}
        onRefresh={load}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
        onOpenCameraScan={() => setCameraScanOpen(true)}
        onExport={handleExport}
        saving={saving}
        isDrawMode={!isMove && drawOpen}
        onActivateMove={activateMove}
      />
      {cameraScanOpen && (
        <CameraScanModal
          getViewport={() =>
            canvasRef.current?.getViewportWorld() ?? {
              centerX: 0, centerY: 0, worldW: 1400, worldH: 1400,
            }
          }
          onCommit={(scanned) => {
            setItems((xs) => {
              const base = xs.length;
              return [...xs, ...scanned.map((it, i) => ({ ...it, z: base + i }))];
            });
          }}
          onCommitStrokes={(traced) => {
            setStrokes((prev) => [...prev, ...traced]);
          }}
          onClose={() => setCameraScanOpen(false)}
        />
      )}
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
          onAISubmit={handleAISubmit}
          aiLoading={aiLoading}
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
          onExportBoardHere={exportBoardHere}
          onSendToStorage={sendToStorage}
          onRestoreFromStorageAt={restoreFromStorageAt}
          onMerge={mergeItems}
          onDropIntoBoard={dropIntoBoard}
          onOpenDocument={setOpenDocumentId}
          onOpenPaper={setOpenPaperId}
          onCopyToStorage={copyImageToStorage}
          onCreateBoardWithCover={createBoardWithCover}
          freshItemId={freshItemId}
          onClearFresh={clearFreshItem}
          peers={peers}
          onLocalCursorMove={sendCursor}
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

      <StoragePanel
        items={storedItems}
        onRestoreToCanvasCenter={restoreFromStorageCenter}
        onDelete={deleteFromStorage}
      />

      {openDocumentId && (() => {
        const doc = items.find((it) => it.id === openDocumentId);
        if (!doc) return null;
        return (
          <DocumentEditor
            item={doc}
            onUpdate={(patch) => updateItem(doc.id, patch)}
            onClose={() => setOpenDocumentId(null)}
          />
        );
      })()}

      {openPaperId && (() => {
        const paper = items.find((it) => it.id === openPaperId);
        if (!paper) return null;
        return (
          <DrawPaper
            item={paper}
            onUpdate={(patch) => updateItem(paper.id, patch)}
            onClose={() => setOpenPaperId(null)}
          />
        );
      })()}
    </div>
  );
}
