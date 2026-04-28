// Tiny inline icons (no extra dependency). 24x24 viewBox, currentColor stroke.
import type { SVGProps, ReactNode } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const wrap = (path: ReactNode) => ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} {...base} {...rest}>{path}</svg>
);

export const StickyIcon = wrap(
  <>
    <path d="M5 5h10l4 4v10H5z" />
    <path d="M15 5v4h4" />
  </>
);

export const LinkIcon = wrap(
  <>
    <path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 1 0-5.6-5.6L11 7" />
    <path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 1 0 5.6 5.6L13 17" />
  </>
);

export const BoardIcon = wrap(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </>
);

export const ImageIcon = wrap(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </>
);

export const PenIcon = wrap(
  <>
    <path d="M14 4 4 14v6h6L20 10z" />
    <path d="m13 5 6 6" />
  </>
);

export const HandIcon = wrap(
  <>
    <path d="M7 11V6a1.5 1.5 0 0 1 3 0v5" />
    <path d="M10 11V5a1.5 1.5 0 0 1 3 0v6" />
    <path d="M13 11V6a1.5 1.5 0 0 1 3 0v7" />
    <path d="M16 9a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1c-2 0-3-1-4-2L4 14a1.5 1.5 0 0 1 2.1-2.1L8 14" />
  </>
);

export const GripIcon = wrap(
  <>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </>
);

export const TrashIcon = wrap(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
  </>
);

export const EraserIcon = wrap(
  <>
    <path d="m4 16 8-8 6 6-8 8H6z" />
    <path d="M14 6 20 12" />
  </>
);

export const StylusIcon = wrap(
  <>
    <path d="M16 3 21 8 9 20H4v-5z" />
    <path d="m13 6 5 5" />
    <path d="M5 22h14" />
  </>
);

export const SettingsIcon = wrap(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
);

export const CloseIcon = wrap(
  <>
    <path d="M6 6 18 18" />
    <path d="M18 6 6 18" />
  </>
);

export const DownloadIcon = wrap(
  <>
    <path d="M12 4v12" />
    <path d="m6 11 6 6 6-6" />
    <path d="M4 20h16" />
  </>
);

export const UploadIcon = wrap(
  <>
    <path d="M12 20V8" />
    <path d="m6 13 6-6 6 6" />
    <path d="M4 4h16" />
  </>
);

export const ResizeIcon = wrap(
  <>
    <path d="m9 21 12-12" />
    <path d="m14 21 7-7" />
    <path d="m19 21 2-2" />
  </>
);

