import { useEffect, useRef, useState, type ComponentType } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem } from '../types';
import { api } from '../api';
import {
  StickyIcon, LinkIcon, BoardIcon, ImageIcon, TextIcon, DocumentIcon,
  SettingsIcon, CameraIcon,
} from './icons';
import Tooltip from './Tooltip';

type ItemTemplate = Omit<BaseItem, 'x' | 'y'>;

interface Props {
  roomCode: string;
  onAdd: (template: ItemTemplate) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenTutorial: () => void;
  onOpenCameraScan: () => void;
  onExport: (fmt: 'png' | 'json') => void;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  isDrawMode?: boolean;
  onActivateMove?: () => void;
}

const STICKY_COLORS = ['#FFF3C4', '#FFDEDE', '#D4F0DE', '#E0EDFF', '#F0E4FF'];

function template(partial: Partial<BaseItem>): ItemTemplate {
  return {
    id: nanoid(10),
    type: 'sticky',
    w: 198,
    h: 164,
    z: 0,
    data: {},
    ...partial,
  } as ItemTemplate;
}

interface NavBtnProps {
  Icon: ComponentType<{ size?: number }>;
  label: string;
  hint: string;
  dragData?: string;
  onClick: () => void;
}

function NavBtn({ Icon, label, hint, dragData, onClick }: NavBtnProps) {
  const [hov, setHov] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wasDragged = useRef(false);

  function onDragStart(e: React.DragEvent) {
    if (!dragData) { e.preventDefault(); return; }
    wasDragged.current = true;
    setDragging(true);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/milart-item', dragData);
  }
  function onDragEnd() {
    setDragging(false);
    setTimeout(() => { wasDragged.current = false; }, 0);
  }

  // Utility buttons (no dragData) are click-only.
  // Canvas item buttons can also be clicked to place at centre.
  function handleClick() {
    if (wasDragged.current) return;
    onClick();
  }

  const tooltipLabel = dragData ? `${hint} — drag onto canvas` : hint;

  return (
    <Tooltip label={tooltipLabel} side="right">
      <button
        draggable={!!dragData}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={handleClick}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        className={`w-14 flex flex-col items-center justify-center gap-[3px] py-[9px] rounded-[11px] border-0 transition-colors ${
          dragging ? 'opacity-50 scale-95' : hov ? 'bg-ink/10 text-ink' : 'text-ink/50'
        }`}
        style={{ cursor: dragData ? 'grab' : 'pointer' }}
      >
        <Icon size={18} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.07em] leading-none">{label}</span>
      </button>
    </Tooltip>
  );
}

export default function Sidebar({ roomCode, onAdd, onRefresh, onOpenSettings, onOpenTutorial, onOpenCameraScan, onExport, isDrawMode, onActivateMove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [exportOpen]);

  function addItem(tmpl: ItemTemplate) {
    if (isDrawMode && onActivateMove) onActivateMove();
    onAdd(tmpl);
  }

  function openCameraScan() {
    if (isDrawMode && onActivateMove) onActivateMove();
    onOpenCameraScan();
  }

  function makeTemplate(partial: Partial<BaseItem>): ItemTemplate {
    return template(partial);
  }

  const tools: { label: string; hint: string; Icon: ComponentType<{ size?: number }>; action: () => void; dragData?: string }[] = [
    {
      label: 'Scan',
      hint: 'AI scan — photograph a whiteboard or notebook and convert it to editable strokes',
      Icon: CameraIcon,
      action: openCameraScan,
    },
    {
      label: 'Sticky',
      hint: 'Colorful sticky note — great for quick ideas, tasks or brainstorming',
      Icon: StickyIcon,
      get dragData() {
        return JSON.stringify(makeTemplate({
          type: 'sticky',
          data: { text: '', color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)] },
        }));
      },
      action: () => addItem(template({
        type: 'sticky',
        data: { text: '', color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)] },
      })),
    },
    {
      label: 'Text',
      hint: 'Free text block — use for labels, titles, callouts or longer notes',
      Icon: TextIcon,
      dragData: JSON.stringify(template({ type: 'link', w: 178, h: 66, data: { url: '', title: '' } })),
      action: () => addItem(template({
        type: 'link', w: 178, h: 66,
        data: { url: '', title: '' },
      })),
    },
    {
      label: 'Board',
      hint: 'Nested board — create a sub-space to organise ideas into focused groups',
      Icon: BoardIcon,
      dragData: JSON.stringify(template({ type: 'board', w: 118, h: 138, data: { name: 'New board' } })),
      action: () => addItem(template({
        type: 'board', w: 118, h: 138,
        data: { name: 'New board' },
      })),
    },
    {
      label: 'Image',
      hint: 'Image — tap to upload a photo or file; drag to drop a placeholder then set it later',
      Icon: ImageIcon,
      dragData: JSON.stringify(template({ type: 'image', w: 218, h: 148, data: { url: '' } })),
      action: () => fileRef.current?.click(),
    },
    {
      label: 'Link',
      hint: 'URL card — paste any link; YouTube URLs auto-embed as playable videos',
      Icon: LinkIcon,
      dragData: JSON.stringify(template({ type: 'link', w: 218, h: 44, data: { url: '', title: '' } })),
      action: () => addItem(template({
        type: 'link', w: 218, h: 44,
        data: { url: '', title: '' },
      })),
    },
    {
      label: 'Doc',
      hint: 'Document — rich-text editor with formatting; import .docx or .txt files',
      Icon: DocumentIcon,
      dragData: JSON.stringify(template({
        type: 'document', w: 168, h: 200,
        data: { title: 'Untitled', content: '' },
      })),
      action: () => addItem(template({
        type: 'document', w: 168, h: 200,
        data: { title: 'Untitled', content: '' },
      })),
    },
    {
      label: 'PDF',
      hint: 'PDF file — upload a PDF to keep it on the canvas; click to open or download it',
      Icon: PDFIconSidebar,
      action: () => pdfRef.current?.click(),
    },
  ];

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await api.uploadImage(file);
      onAdd(template({ type: 'image', w: 218, h: 148, data: { url } }));
    } catch (err) {
      alert('Image upload failed: ' + (err as Error).message);
    }
  }

  async function onPDFFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await api.uploadFile(file);
      if (isDrawMode && onActivateMove) onActivateMove();
      onAdd(template({ type: 'pdf', w: 220, h: 144, data: { url, name: file.name, size: file.size } }));
    } catch (err) {
      alert('PDF upload failed: ' + (err as Error).message);
    }
  }

  return (
    <aside className="w-14 shrink-0 h-full flex flex-col bg-paper border-r border-ink/10 items-center z-10">
      {/* Logo */}
      <div className="w-14 h-14 flex items-center justify-center border-b border-ink/10">
        <button
          onClick={() => navigator.clipboard?.writeText(roomCode)}
          className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-white text-[15px] font-extrabold border-0"
          style={{
            background: 'linear-gradient(135deg, #D97435, #E8B830)',
            boxShadow: '0 2px 10px rgba(217,116,53,0.32)',
          }}
          title={roomCode ? `Room: ${roomCode} — click to copy` : 'Copy room code'}
        >M</button>
      </div>

      {/* Add tools */}
      <div className="flex flex-col gap-px py-2.5 border-b border-ink/10 w-full items-center">
        {tools.map(({ label, hint, Icon, action, dragData }) => (
          <NavBtn key={label} Icon={Icon} label={label} hint={hint} dragData={dragData} onClick={action} />
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
        <input
          ref={pdfRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onPDFFile}
        />
      </div>

      <div className="flex-1" />

      {/* Utility buttons */}
      <div className="flex flex-col gap-px py-2.5 border-t border-ink/10 w-full items-center">
        {/* Export button with format dropdown */}
        <div className="relative w-full flex justify-center">
          <Tooltip label="Export canvas — save as PNG screenshot or JSON data" side="right">
            <button
              onClick={() => setExportOpen((v) => !v)}
              className="w-14 flex flex-col items-center justify-center gap-[3px] py-[9px] rounded-[11px] border-0 transition-colors text-ink/50 hover:bg-ink/10 hover:text-ink"
              style={{ cursor: 'pointer' }}
            >
              <ExportIconLocal size={18} />
              <span className="text-[9px] font-semibold uppercase tracking-[0.07em] leading-none">Export</span>
            </button>
          </Tooltip>
          {exportOpen && (
            <div
              className="absolute bottom-full left-full ml-2 mb-1 rounded-xl border border-ink/10 bg-paper shadow-xl overflow-hidden z-[9999]"
              style={{ minWidth: 170 }}
            >
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-ink/40">Export canvas as</div>
              <button
                onClick={() => { setExportOpen(false); onExport('png'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold hover:bg-ink/[0.06] transition-colors text-left"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" />
                </svg>
                PNG screenshot
              </button>
              <button
                onClick={() => { setExportOpen(false); onExport('json'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold hover:bg-ink/[0.06] transition-colors text-left"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                JSON data
              </button>
            </div>
          )}
        </div>
        <NavBtn Icon={RefreshIconLocal} label="Refresh" hint="Reload board from server to get the latest changes" onClick={onRefresh} />
        <NavBtn Icon={HelpIconLocal} label="Help" hint="Show tutorial and keyboard shortcuts" onClick={onOpenTutorial} />
        <NavBtn Icon={SettingsIcon} label="Settings" hint="Adjust room settings and display preferences" onClick={onOpenSettings} />
      </div>
    </aside>
  );
}

function ExportIconLocal({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// Local refresh icon — mirrors the design's IRefresh shape.
function RefreshIconLocal({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

// Help / tutorial icon — a circled exclamation mark.
function HelpIconLocal({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function PDFIconSidebar({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
