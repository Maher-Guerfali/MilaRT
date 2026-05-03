import mongoose from 'mongoose';

const { Schema, model, Types } = mongoose;

const ItemSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      // 'handwriting' kept here for back-compat with any existing data; not used by new clients.
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

const StrokeSchema = new Schema(
  {
    color: { type: String, default: '#1b1b1b' },
    width: { type: Number, default: 2 },
    tool: { type: String, enum: ['pen', 'fountain', 'pencil', 'marker', 'brush'], default: 'pen' },
    points: { type: [Number], default: [] },
  },
  { _id: false }
);

const BoardSchema = new Schema(
  {
    roomId: { type: Types.ObjectId, ref: 'Room', required: true, index: true },
    parentBoardId: { type: Types.ObjectId, ref: 'Board', default: null, index: true },
    name: { type: String, default: 'Untitled board' },
    items: { type: [ItemSchema], default: [] },
    strokes: { type: [StrokeSchema], default: [] },
  },
  { timestamps: true }
);

const RoomSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: 'My room' },
    rootBoardId: { type: Types.ObjectId, ref: 'Board' },
    // Room-wide "Storage" drawer — items live here independently of any
    // board so they can be dragged from one board into another.
    storage: { type: [ItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Room = model('Room', RoomSchema);
export const Board = model('Board', BoardSchema);

const FeedbackSchema = new Schema(
  {
    text: { type: String, required: true, maxlength: 4000 },
  },
  { timestamps: true }
);

export const Feedback = model('Feedback', FeedbackSchema);
