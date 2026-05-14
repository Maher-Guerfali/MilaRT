export type ItemType = 'sticky' | 'image' | 'link' | 'board' | 'document';

export interface BaseItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  data: Record<string, unknown>;
}

export interface StickyData { text: string; color: string; fontSize?: number; font?: 'handwriting'; }
export interface ImageData { url: string; }
export interface LinkData { url: string; title: string; fontSize?: number; font?: 'handwriting'; }
export interface BoardRefData {
  boardId: string;
  name: string;
  // Optional custom thumbnail uploaded by the user.
  imageUrl?: string;
}
export interface DocumentData {
  title: string;
  // Sanitised HTML produced by the in-app editor (or imported from .docx).
  content: string;
}

export type StrokeTool = 'pen' | 'fountain' | 'pencil' | 'marker' | 'brush';

export interface Stroke {
  color: string;
  width: number;
  // Optional — older strokes default to 'pen'.
  tool?: StrokeTool;
  // [x, y, pressure] triplets stored in board (world) coordinates.
  points: number[];
}

export interface Board {
  _id: string;
  roomId: string;
  parentBoardId: string | null;
  name: string;
  items: BaseItem[];
  strokes: Stroke[];
  updatedAt: string;
  breadcrumbs: { _id: string; name: string }[];
}

export interface Room {
  code: string;
  name: string;
  rootBoardId: string;
}

// ── Export / Import v2 ─────────────────────────────────────────────────
// A self-contained snapshot of one board (items + strokes).
export interface BoardSnapshot {
  id: string;            // MongoDB _id as string
  name: string;
  parentBoardId: string | null;
  items: BaseItem[];
  strokes: Stroke[];
}

// ── AI assistant ───────────────────────────────────────────────────────
export type AIOperationType = 'move' | 'resize' | 'update' | 'add' | 'delete';

export interface AIOperation {
  type: AIOperationType;
  /** Target item id (required for move / resize / update / delete) */
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Partial data to merge into item.data (for type === 'update') */
  data?: Record<string, unknown>;
  /** Full new item to create (for type === 'add') */
  item?: BaseItem;
}

// Full room export — all boards in one file, including nested ones.
// Image items may have data.url as a base64 data: URL when exported
// with the "portable" option so images travel with the file.
export interface RoomExportV2 {
  $schema: 'milart/v2';
  version: 2;
  type: 'milart-room';
  exportedAt: string;
  room: {
    code: string;
    name: string;
    rootBoardId: string;
  };
  boards: BoardSnapshot[];
}

// Single-board export (v2).
export interface BoardExportV2 {
  $schema: 'milart/v2';
  version: 2;
  type: 'milart-board';
  exportedAt: string;
  name: string;
  items: BaseItem[];
  strokes: Stroke[];
}

// Legacy v1 kept for reading old exports.
export interface BoardExportV1 {
  version: 1;
  type: 'milart-board';
  exportedAt: string;
  name: string;
  items: BaseItem[];
  strokes: Stroke[];
}

export type AnyMilartExport = BoardExportV1 | BoardExportV2 | RoomExportV2;
