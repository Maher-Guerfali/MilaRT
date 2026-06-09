import { useRef, useState, type ComponentType } from 'react';
import { nanoid } from 'nanoid';
import type { BaseItem } from '../types';
import { api } from '../api';
import {
  StickyIcon, LinkIcon, BoardIcon, ImageIcon, TextIcon, DocumentIcon,
  SettingsIcon, CameraIcon, PdfIcon,
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

export default function Sidebar({ roomCode, onAdd, onRefresh, onOpenSettings, onOpenTutorial, onOpenCameraScan, isDrawMode, onActivateMove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

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
      hint: 'Scan a whiteboard or notebook with AI',
      Icon: CameraIcon,
      action: openCameraScan,
    },
    {
      label: 'Sticky',
      hint: 'Drag or tap to add a sticky note',
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
      hint: 'Drag or tap to add free text',
      Icon: TextIcon,
      dragData: JSON.stringify(template({ type: 'link', w: 178, h: 66, data: { url: '', title: '' } })),
      action: () => addItem(template({
        type: 'link', w: 178, h: 66,
        data: { url: '', title: '' },
      })),
    },
    {
      label: 'Board',
      hint: 'Drag or tap to add a nested board',
      Icon: BoardIcon,
      dragData: JSON.stringify(template({ type: 'board', w: 118, h: 138, data: { name: 'New board' } })),
      action: () => addItem(template({
        type: 'board', w: 118, h: 138,
        data: { name: 'New board' },
      })),
    },
    {
      label: 'Image',
      hint: 'Tap to upload or drag a placeholder',
      Icon: ImageIcon,
      // Drag: drop an empty image placeholder where the cursor is.
      dragData: JSON.stringify(template({ type: 'image', w: 218, h: 148, data: { url: '' } })),
      // Tap: open the file picker — selected file is uploaded and added to
      // the canvas centre via onFile below.
      action: () => fileRef.current?.click(),
    },
    {
      label: 'Link',
      hint: 'Drag or tap to add a URL card',
      Icon: LinkIcon,
      dragData: JSON.stringify(template({ type: 'link', w: 218, h: 44, data: { url: '', title: '' } })),
      action: () => addItem(template({
        type: 'link', w: 218, h: 44,
        data: { url: '', title: '' },
      })),
    },
    {
      label: 'Doc',
      hint: 'Drag or tap to add a document',
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
      hint: 'Tap to upload a PDF',
      Icon: PdfIcon,
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

  async function onPdfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (isDrawMode && onActivateMove) onActivateMove();
    try {
      const { url } = await api.uploadPdf(file);
      onAdd(template({ type: 'pdf', w: 320, h: 420, data: { url, name: file.name } }));
    } catch (err) {
      alert('PDF upload failed: ' + (err as Error).message);
    }
  }

  return (
    <aside className="w-14 shrink-0 h-full flex flex-col bg-paper border-r border-ink/10 items-center z-10">
      {/* Logo */}
      <div className="w-14 h-14 flex items-center justify-center border-b border-ink/10">
        <Tooltip label={roomCode ? `Room: ${roomCode}` : null} side="right">
          <button
            onClick={() => navigator.clipboard?.writeText(roomCode)}
            className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-white text-[15px] font-extrabold border-0"
            style={{
              background: 'linear-gradient(135deg, #D97435, #E8B830)',
              boxShadow: '0 2px 10px rgba(217,116,53,0.32)',
            }}
            title="Copy room code"
          >M</button>
        </Tooltip>
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
          accept="application/pdf"
          className="hidden"
          onChange={onPdfFile}
        />
      </div>

      <div className="flex-1" />

      {/* Utility buttons */}
      <div className="flex flex-col gap-px py-2.5 border-t border-ink/10 w-full items-center">
        <NavBtn Icon={RefreshIconLocal} label="Refresh" hint="Reload from server" onClick={onRefresh} />
        <NavBtn Icon={HelpIconLocal} label="Help" hint="Show tutorial" onClick={onOpenTutorial} />
        <NavBtn Icon={SettingsIcon} label="Settings" hint="Settings" onClick={onOpenSettings} />
      </div>
    </aside>
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
