import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;

// Embedded item on a board. `data` is type-specific and intentionally loose
// so the client can evolve item shapes without server migrations.
const ItemSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['sticky', 'image', 'link', 'board', 'handwriting'],
      required: true,
    },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    w: { type: Number, default: 220 },
    h: { type: Number, default: 160 },
    z: { type: Number, default: 0 },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const BoardSchema = new Schema(
  {
    roomId: { type: Types.ObjectId, ref: 'Room', required: true, index: true },
    parentBoardId: { type: Types.ObjectId, ref: 'Board', default: null, index: true },
    name: { type: String, default: 'Untitled board' },
    items: { type: [ItemSchema], default: [] },
  },
  { timestamps: true }
);

const RoomSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'My room' },
    rootBoardId: { type: Types.ObjectId, ref: 'Board' },
  },
  { timestamps: true }
);

export const Room = model('Room', RoomSchema);
export const Board = model('Board', BoardSchema);
