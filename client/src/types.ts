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

export interface StickyData { text: string; color: string; fontSize?: number; bold?: boolean; }
export interface ImageData {
  url: string;
  // AI-generated short caption used as the image's mind-map label and a11y alt.
  // Filled automatically the first time the photo is added (see BoardPage).
  caption?: string;
}
export interface LinkData { url: string; title: string; fontSize?: number; bold?: boolean; }
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

// ── Mind map ─────────────────────────────────────────────────────────────
// A semantic graph derived from the current board's items. Nodes mirror
// items 1:1 (by id); edges are AI-inferred (or proximity-fallback) relations.
export type MindMapPosition = 'left' | 'right' | 'full';

export interface MindEdge {
  source: string;   // item id
  target: string;   // item id
  /** Short relationship word/phrase, e.g. "supports", "example of". */
  label?: string;
}

// Persisted (localStorage, per board) so the graph is stable across opens.
export interface MindMapCache {
  edges: MindEdge[];
  /** Settled node positions, keyed by item id. */
  positions?: Record<string, { x: number; y: number }>;
  /** Item-set signature at generation time — lets us know when to re-link. */
  signature?: string;
  updatedAt?: string;
}
