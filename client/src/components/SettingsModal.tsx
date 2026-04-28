import { useRef, useState } from 'react';
import type { BaseItem, Stroke } from '../types';
import { CloseIcon, DownloadIcon, UploadIcon } from './icons';

interface ExportPayload {
  version: 1;
  type: 'milart-board';
  exportedAt: string;
  name: string;
  items: BaseItem[];
  strokes: Stroke[];
}

interface Props {
  open: boolean;
  roomCode: string;
  boardName: string;
  items: BaseItem[];
  strokes: Stroke[];
  onClose: () => void;
  onImport: (payload: { name: string; items: BaseItem[]; strokes: Stroke[] }) => void;
}

export default function SettingsModal({
  open, roomCode, boardName, items, strokes, onClose, onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (!open) return null;

  function handleExport() {
    const payload: ExportPayload = {
      version: 1,
      type: 'milart-board',
      exportedAt: new Date().toISOString(),
      name: boardName,
      items,
      strokes,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (boardName || 'board').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
    a.href = url;
    a.download = `mboard-${safeName}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMsg({ kind: 'ok', text: 'Exported.' });
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<ExportPayload>;
      if (data.type !== 'milart-board' || !Array.isArray(data.items)) {
        throw new Error('That file does not look like an M-Board export.');
      }
      const ok = window.confirm(
        `Import "${data.name || 'board'}"?\n\nThis will replace the current board's contents (${items.length} items, ${strokes.length} strokes).`
      );
      if (!ok) return;
      onImport({
        name: typeof data.name === 'string' ? data.name : boardName,
        items: data.items as BaseItem[],
        strokes: Array.isArray(data.strokes) ? (data.strokes as Stroke[]) : [],
      });
      setMsg({ kind: 'ok', text: 'Imported. Note: image cards still point to their original URLs and may not load if the source server is gone.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
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
              <button
                onClick={handleExport}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper"
              >
                <DownloadIcon size={16} />
                <span>Export this board to JSON</span>
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 w-full text-left rounded-md px-3 py-2 text-sm border border-ink/20 hover:bg-ink hover:text-paper"
              >
                <UploadIcon size={16} />
                <span>Import from JSON</span>
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
              <p className="text-xs text-ink/50 leading-snug">
                Export saves all items, strokes, and the board name. Image data
                isn't embedded — image cards in an exported file will reference
                their original URLs, which only resolve on the server they
                were uploaded to.
              </p>
            </div>
          </section>

          {msg && (
            <div className={`text-sm rounded-md px-3 py-2 ${
              msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>{msg.text}</div>
          )}
        </div>
      </div>
    </div>
  );
}
