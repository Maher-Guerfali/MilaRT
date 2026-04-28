export type ItemType = 'sticky' | 'image' | 'link' | 'board';

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

export interface StickyData { text: string; color: string; }
export interface ImageData { url: string; }
export interface LinkData { url: string; title: string; }
export interface BoardRefData {
  boardId: string;
  name: string;
  // Optional custom thumbnail uploaded by the user.
  imageUrl?: string;
}

export interface Stroke {
  color: string;
  width: number;
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
