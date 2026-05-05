import { useEffect, useRef, useState } from 'react';
import type { BaseItem, DocumentData } from '../types';
import { DocumentIcon } from './icons';

interface Props {
  item: BaseItem;
  onUpdate: (patch: Partial<BaseItem>) => void;
  onClose: () => void;
}

const FONT_SIZES = [10, 12, 14, 16, 18, 22, 28, 36];
const FONT_COLORS = ['#1A1510', '#D97435', '#1F76C9', '#117A4F', '#9B27B0', '#C0392B'];
const HIGHLIGHT_COLORS = [
  'transparent',
  '#FFF59D',
  '#FFB59D',
  '#B3E5FC',
  '#C8E6C9',
  '#F8BBD0',
];

// Document items hold a title + sanitised HTML body. The editor is a
// fullscreen "paper" surface — contentEditable + execCommand keeps the
// implementation small while still supporting bold / italic / colour /
// highlight / font size and .docx import via mammoth.
export default function DocumentEditor({ item, onUpdate, onClose }: Props) {
  const data = item.data as Partial<DocumentData>;
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState<string>(data.title ?? 'Untitled');

  // Initialise the editor with the persisted HTML once.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = data.content ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  }

  function handleClose() {
    const html = editorRef.current?.innerHTML ?? '';
    onUpdate({ data: { ...data, title, content: html } });
    onClose();
  }

  // Save on Esc as well as the X button so muscle memory works.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  async function importDocx(file: File) {
    try {
      // Mammoth ships a browser bundle that does not need Node fs. We
      // import it dynamically so the main board bundle stays small.
      const mammoth = (await import('mammoth/mammoth.browser')) as {
        convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
      };
      const buf = await file.arrayBuffer();
      const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
      if (editorRef.current) editorRef.current.innerHTML = value;
    } catch (err) {
      alert(`Failed to import document: ${(err as Error).message}`);
    }
  }

  async function importTxt(file: File) {
    const text = await file.text();
    const html = text
      .split(/\r?\n/)
      .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br/>'}</p>`)
      .join('');
    if (editorRef.current) editorRef.current.innerHTML = html;
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'docx') importDocx(f);
    else importTxt(f); // .txt / .md / anything else → plain text
  }

  return (
    <div
      className="fixed inset-0 z-[300000] flex items-center justify-center"
      style={{ background: 'rgba(15, 12, 8, 0.78)', backdropFilter: 'blur(6px)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="flex flex-col"
        style={{
          width: 'min(820px, 92vw)',
          maxHeight: '92vh',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 rounded-t-xl bg-paper border border-ink/10 flex-wrap">
          <span className="text-ink/55 mr-1"><DocumentIcon size={14} /></span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-[13px] font-bold text-ink bg-transparent outline-none px-1.5 py-1 rounded hover:bg-ink/5 focus:bg-ink/5 mr-2"
            style={{ minWidth: 100 }}
            placeholder="Untitled"
          />

          <ToolbarBtn label="B" title="Bold (Ctrl+B)" onClick={() => exec('bold')} bold />
          <ToolbarBtn label="I" title="Italic (Ctrl+I)" onClick={() => exec('italic')} italic />
          <ToolbarBtn label="U" title="Underline (Ctrl+U)" onClick={() => exec('underline')} underline />

          <Divider />

          <select
            title="Font size"
            onChange={(e) => {
              // execCommand fontSize takes 1–7. Apply size via inline style
              // by wrapping selection in a span — execCommand fontSize
              // is too coarse. Trick: set fontSize=7 then replace.
              const px = e.target.value;
              applyFontSize(px);
              e.target.value = '';
            }}
            className="text-[11px] bg-transparent border border-ink/15 rounded px-1.5 py-1 hover:bg-ink/5"
            defaultValue=""
          >
            <option value="" disabled>Size</option>
            {FONT_SIZES.map((s) => (
              <option key={s} value={String(s)}>{s} px</option>
            ))}
          </select>

          <Divider />

          <span className="text-[10px] text-ink/55 px-1">Color</span>
          {FONT_COLORS.map((c) => (
            <button
              key={c}
              title={`Text colour ${c}`}
              onClick={() => exec('foreColor', c)}
              className="w-5 h-5 rounded-full border border-ink/15 hover:scale-110 transition-transform"
              style={{ background: c }}
            />
          ))}

          <Divider />

          <span className="text-[10px] text-ink/55 px-1">Highlight</span>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              title={c === 'transparent' ? 'Remove highlight' : `Highlight ${c}`}
              onClick={() => exec('hiliteColor', c === 'transparent' ? 'transparent' : c)}
              className="w-5 h-5 rounded-full border border-ink/15 hover:scale-110 transition-transform relative overflow-hidden"
              style={{ background: c === 'transparent' ? '#fff' : c }}
            >
              {c === 'transparent' && (
                <span className="absolute inset-0 flex items-center justify-center text-ink/45 text-[10px]">∅</span>
              )}
            </button>
          ))}

          <Divider />

          <button
            onClick={() => fileRef.current?.click()}
            title="Import .docx, .txt or .md"
            className="px-2 py-1 rounded text-[11px] bg-amber/15 text-amber hover:bg-amber/25 transition-colors font-bold"
          >Import…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.txt,.md,text/plain"
            className="hidden"
            onChange={onFile}
          />

          <div className="flex-1" />

          <button
            onClick={handleClose}
            title="Close (Esc)"
            className="w-7 h-7 rounded-full text-ink/55 hover:bg-ink/10 hover:text-ink flex items-center justify-center font-bold"
          >×</button>
        </div>

        {/* Paper surface */}
        <div
          className="flex-1 overflow-y-auto bg-white border border-t-0 border-ink/10 rounded-b-xl"
          style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}
        >
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="outline-none text-ink"
            style={{
              minHeight: 'calc(min(900px, 80vh))',
              padding: '64px 72px',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label, title, onClick, bold, italic, underline,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded text-[12px] text-ink/75 hover:bg-ink/10 hover:text-ink transition-colors"
      style={{
        fontWeight: bold ? 700 : 600,
        fontStyle: italic ? 'italic' : 'normal',
        textDecoration: underline ? 'underline' : 'none',
      }}
    >{label}</button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-ink/12 mx-1" />;
}

// execCommand 'fontSize' only takes 1–7. Apply px via a tagged span by
// running fontSize first and then walking the tree to swap to px.
function applyFontSize(px: string) {
  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand('fontSize', false, '7');
  const fonts = document.getElementsByTagName('font');
  for (let i = fonts.length - 1; i >= 0; i--) {
    const f = fonts[i];
    if (f.size === '7') {
      f.removeAttribute('size');
      f.style.fontSize = `${px}px`;
    }
  }
}
