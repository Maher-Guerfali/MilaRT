import { useEffect } from 'react';
import type { BaseItem, PdfData } from '../types';
import { PdfIcon } from './icons';

interface Props {
  item: BaseItem;
  onClose: () => void;
}

// In-app PDF reader. Uses the browser's built-in PDF rendering via an
// <iframe> pointing at the uploaded file URL. Closes on Esc or backdrop
// click. A "Open in new tab" button is provided as a fallback for
// browsers that block PDF iframes (some mobile Safari builds).
export default function PdfViewer({ item, onClose }: Props) {
  const d = item.data as Partial<PdfData>;
  const url = d.url ?? '';
  const title = d.title || 'document.pdf';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[300000] flex items-center justify-center"
      style={{ background: 'rgba(15, 12, 8, 0.78)', backdropFilter: 'blur(6px)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col"
        style={{ width: 'min(960px, 94vw)', height: 'min(92vh, 1000px)' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-xl bg-paper border border-ink/10">
          <span className="text-ink/55"><PdfIcon size={16} /></span>
          <span
            className="text-[13px] font-bold text-ink truncate flex-1"
            title={title}
          >{title}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded text-[11px] bg-amber/15 text-amber hover:bg-amber/25 transition-colors font-bold"
            title="Open PDF in a new tab"
          >Open in tab</a>
          <a
            href={url}
            download={title}
            className="px-2 py-1 rounded text-[11px] bg-ink/8 text-ink/70 hover:bg-ink/15 transition-colors font-bold"
            title="Download"
          >Download</a>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="w-7 h-7 rounded-full text-ink/55 hover:bg-ink/10 hover:text-ink flex items-center justify-center font-bold"
          >×</button>
        </div>

        <div
          className="flex-1 bg-white border border-t-0 border-ink/10 rounded-b-xl overflow-hidden"
          style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}
        >
          {url ? (
            <iframe
              src={url}
              title={title}
              className="w-full h-full block"
              style={{ border: 0 }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/45 text-[12px]">
              No PDF file attached.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
