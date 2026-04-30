import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BaseItem, Stroke, BoardExportV2, RoomExportV2, BoardSnapshot } from '../types';
import { api } from '../api';
import { CloseIcon, DownloadIcon, UploadIcon, LogoutIcon } from './icons';

// ── image-embedding helpers (module-level, no React deps) ─────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Walk an items array and replace every image item's url with a base64
 * data: URL so the file is fully self-contained.  Falls back to the
 * original URL if fetch fails (CORS, network error, etc.).
 * Returns { items, embedded, kept } — 'kept' counts fallbacks.
 */
async function embedImages(
  items: BaseItem[],
  onProgress: (done: number, total: number) => void,
): Promise<{ items: BaseItem[]; embedded: number; kept: number }> {
  const imageItems = items.filter(it => it.type === 'image');
  if (!imageItems.length) return { items, embedded: 0, kept: 0 };

  let done = 0;
  let embedded = 0;
  let kept = 0;

  const result = await Promise.all(
    items.map(async (item) => {
      if (item.type !== 'image') return item;
      const url = (item.data as { url: string }).url;
      if (!url || url.startsWith('data:')) {
        done++; embedded++;
        onProgress(done, imageItems.length);
        return item;
      }
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const dataUrl = await blobToDataUrl(await resp.blob());
        done++; embedded++;
        onProgress(done, imageItems.length);
        return { ...item, data: { ...(item.data as object), url: dataUrl, _originalUrl: url } };
      } catch {
        done++; kept++;
        onProgress(done, imageItems.length);
        return item; // keep original URL as fallback
      }
    }),
  );
  return { items: result, embedded, kept };
}

/**
 * For each image item whose url is a base64 data: URL, upload it to the
 * server via /api/upload and replace with the server URL.
 */
async function reuploadImages(
  items: BaseItem[],
  onProgress: (done: number, total: number) => void,
): Promise<BaseItem[]> {
  const dataItems = items.filter(
    it => it.type === 'image' && (it.data as { url: string }).url?.startsWith('data:'),
  );
  if (!dataItems.length) return items;

  let done = 0;
  return Promise.all(
    items.map(async (item) => {
      if (item.type !== 'image') return item;
      const url = (item.data as { url: string }).url;
      if (!url?.startsWith('data:')) return item;
      try {
        const blob = await (await fetch(url)).blob();
        const { url: serverUrl } = await api.uploadImage(blob);
        done++;
        onProgress(done, dataItems.length);
        return { ...item, data: { ...(item.data as object), url: serverUrl } };
      } catch {
        done++;
        onProgress(done, dataItems.length);
        return item; // keep data URL as last resort
      }
    }),
  );
}

function downloadJson(payload: unknown, baseName: string) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40)}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── component ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  roomCode: string;
  boardName: string;
  items: BaseItem[];
  strokes: Stroke[];
  onClose: () => void;
  onImport: (payload: { name: string; items: BaseItem[]; strokes: Stroke[] }) => void;
  onRoomImportSuccess: (rootBoardId: string) => void;
}

export default function SettingsModal({
  open, roomCode, boardName, items, strokes, onClose, onImport, onRoomImportSuccess,
}: Props) {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [opLabel, setOpLabel] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [feedback, setFeedback] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'sending' | 'sent' | 'err'>('idle');

  if (!open) return null;

  async function sendFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setFeedbackStatus('sending');
    try {
      await api.sendFeedback(text);
      setFeedbackStatus('sent');
      setFeedback('');
    } catch {
      setFeedbackStatus('err');
    }
  }

  // ── Export: current board (v2, images embedded as base64) ────────────
  async function handleExportBoard() {
    setBusy(true);
    setMsg(null);
    setOpLabel('Embedding images…');
    setProgress({ done: 0, total: items.filter(it => it.type === 'image').length });
    try {
      const { items: embedded, embedded: ok, kept } = await embedImages(items, (done, total) => {
        setProgress({ done, total });
      });
      const payload: BoardExportV2 = {
        $schema: 'milart/v2',
        version: 2,
        type: 'milart-board',
        exportedAt: new Date().toISOString(),
        name: boardName,
        items: embedded,
        strokes,
      };
      downloadJson(payload, `board-${boardName}`);
      const note = kept > 0 ? ` (${kept} image URL${kept !== 1 ? 's' : ''} could not be embedded — check CORS)` : '';
      setMsg({ kind: 'ok', text: `Board exported. ${ok} image${ok !== 1 ? 's' : ''} embedded${note}.` });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      setOpLabel('');
    }
  }

  // ── Export: full room — all boards, all images embedded ──────────────
  async function handleExportRoom() {
    setBusy(true);
    setMsg(null);
    setOpLabel('Fetching all boards…');
    setProgress(null);
    try {
      const roomData = await api.exportRoom(roomCode);
      const totalImages = roomData.boards.reduce(
        (sum, b) => sum + b.items.filter(it => it.type === 'image').length, 0,
      );
      setOpLabel('Embedding images…');
      setProgress({ done: 0, total: totalImages });

      let globalDone = 0;
      const processedBoards: BoardSnapshot[] = await Promise.all(
        roomData.boards.map(async (board) => {
          const { items: embeddedItems } = await embedImages(board.items, () => {
            globalDone++;
            setProgress({ done: globalDone, total: totalImages });
          });
          return { ...board, items: embeddedItems };
        }),
      );

      const payload: RoomExportV2 = { ...roomData, boards: processedBoards };
      downloadJson(payload, `room-${roomCode}`);
      setMsg({
        kind: 'ok',
        text: `Room exported — ${roomData.boards.length} board${roomData.boards.length !== 1 ? 's' : ''}, ${totalImages} image${totalImages !== 1 ? 's' : ''} embedded.`,
      });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      setOpLabel('');
    }
  }

  // ── Import dispatcher ────────────────────────────────────────────────
  async function handleImportFile(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.type === 'milart-room' && data?.version === 2) {
        await handleImportRoom(data as RoomExportV2);
      } else if (data?.type === 'milart-board' && Array.isArray(data?.items)) {
        await handleImportBoard(data as { name?: string; items: BaseItem[]; strokes?: Stroke[] });
      } else {
        throw new Error('Not a valid MilaRT export file (expected milart-board or milart-room v1/v2).');
      }
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
  }

  // ── Import: single board ─────────────────────────────────────────────
  async function handleImportBoard(data: { name?: string; items: BaseItem[]; strokes?: Stroke[] }) {
    const ok = window.confirm(
      `Import board "${data.name || 'board'}"?\n\nThis replaces the current board (${items.length} items, ${strokes.length} strokes). Cannot be undone.`,
    );
    if (!ok) return;

    setBusy(true);
    const dataUrlCount = data.items.filter(
      it => it.type === 'image' && (it.data as { url: string }).url?.startsWith('data:'),
    ).length;
    setOpLabel(dataUrlCount ? 'Uploading images…' : 'Importing…');
    setProgress(dataUrlCount ? { done: 0, total: dataUrlCount } : null);

    try {
      const uploadedItems = await reuploadImages(data.items, (done, total) => {
        setProgress({ done, total });
      });
      onImport({
        name: typeof data.name === 'string' ? data.name : boardName,
        items: uploadedItems,
        strokes: Array.isArray(data.strokes) ? data.strokes : [],
      });
      setMsg({ kind: 'ok', text: `Board imported — ${uploadedItems.length} items, ${(data.strokes || []).length} strokes.` });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      setOpLabel('');
    }
  }

  // ── Import: full room ────────────────────────────────────────────────
  async function handleImportRoom(data: RoomExportV2) {
    const totalItems = data.boards.reduce((s, b) => s + b.items.length, 0);
    const ok = window.confirm(
      `Import full room "${data.room.name}"?\n\n` +
      `This REPLACES all content in room "${roomCode}" — ${data.boards.length} boards, ${totalItems} items total.\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    setBusy(true);
    const totalDataUrls = data.boards.reduce(
      (s, b) => s + b.items.filter(it => it.type === 'image' && (it.data as { url: string }).url?.startsWith('data:')).length, 0,
    );
    setOpLabel(totalDataUrls ? 'Uploading images…' : 'Saving…');
    setProgress(totalDataUrls ? { done: 0, total: totalDataUrls } : null);

    try {
      let globalDone = 0;
      const processedBoards: BoardSnapshot[] = await Promise.all(
        data.boards.map(async (board) => ({
          ...board,
          items: await reuploadImages(board.items, () => {
            globalDone++;
            setProgress({ done: globalDone, total: totalDataUrls });
          }),
        })),
      );

      setOpLabel('Saving to server…');
      setProgress(null);
      const result = await api.importRoom(roomCode, { ...data, boards: processedBoards });
      // navigate first (closes modal via parent), then show brief success
      onRoomImportSuccess(result.rootBoardId);
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
      setBusy(false);
      setProgress(null);
      setOpLabel('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/5">
          <h2 className="font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md hover:bg-ink/5 flex items-center justify-center"
            aria-label="Close"
          ><CloseIcon size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <div className="text-xs uppercase tracking-wider text-ink/50 mb-2">Room</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-base tracking-widest bg-paper px-3 py-1.5 rounded">{roomCode}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(roomCode)}
                className="text-xs px-3 py-1.5 rounded-md border border-ink/20 hover:bg-ink hover:text-paper"
              >Copy code</button>
              <button
                onClick={() => navigator.clipboard?.writeText(window.location.href)}
                className="text-xs px-3 py-1.5 rounded-md border border-ink/20 hover:bg-ink hover:text-paper"
              >Copy link</button>
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-ink/50 mb-2">Backup</div>
            <div className="flex flex-col gap-2">

              {/* Export buttons */}
              <button
                onClick={handleExportBoard}
                disabled={busy}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                <DownloadIcon size={16} />
                <span>Export this board  <span className="text-ink/40">(items + strokes + images)</span></span>
              </button>
              <button
                onClick={handleExportRoom}
                disabled={busy}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                <DownloadIcon size={16} />
                <span>Export full room  <span className="text-ink/40">(all boards + images)</span></span>
              </button>

              {/* Import */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                <UploadIcon size={16} />
                <span>Import from JSON  <span className="text-ink/40">(board or full room)</span></span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleImportFile(f);
                }}
              />

              {/* Progress indicator */}
              {busy && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  <span className="font-medium">{opLabel || 'Working…'}</span>
                  {progress && progress.total > 0 && (
                    <>
                      {' '}{progress.done}/{progress.total}
                      <div className="mt-1 h-1 rounded-full bg-amber-200 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all"
                          style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              <p className="text-xs text-ink/50 leading-snug">
                Exports embed every image as base64 so the file is fully
                self-contained — images survive server moves or re-deploys.
                On import, embedded images are re-uploaded automatically.
              </p>
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-ink/50 mb-2">Danger zone</div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { onClose(); nav('/'); }}
                disabled={busy}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                <LogoutIcon size={16} />
                <span>Leave room (back to home)</span>
              </button>
            </div>
          </section>

          {msg && (
            <div className={`text-sm rounded-md px-3 py-2 ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>{msg.text}</div>
          )}

          <section>
            <div className="text-xs uppercase tracking-wider text-ink/50 mb-2">Feedback</div>
            <div className="flex flex-col gap-2">
              <textarea
                rows={3}
                placeholder="Share a bug, idea, or anything you'd like…"
                value={feedback}
                onChange={(e) => { setFeedback(e.target.value); setFeedbackStatus('idle'); }}
                className="w-full rounded-md border border-ink/20 bg-paper px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {feedbackStatus === 'sent' && (
                <p className="text-xs text-green-700 font-medium">Thanks for your feedback! 🎉</p>
              )}
              {feedbackStatus === 'err' && (
                <p className="text-xs text-red-600">Could not send — please try again.</p>
              )}
              <button
                onClick={sendFeedback}
                disabled={feedbackStatus === 'sending' || !feedback.trim()}
                className="self-end px-4 py-1.5 rounded-md text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #D97435, #F08848)' }}
              >
                {feedbackStatus === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
