// Realtime presence channel for live cursors / multi-user presence.
//
// Presence is scoped to a single board (a room can hold many nested boards).
// Cursors and the peer list only flow between sockets viewing the SAME board,
// so you never see a collaborator's cursor while you're on a different canvas.
//
// Wire format:
//   client -> server:
//     "init"   { roomCode, boardId, identity: { id, name, color } }
//     "board"  { boardId }               // moved to a different board
//     "cursor" { x, y }                  // world coords; throttled by client
//     "leave"                            // optional explicit leave
//
//   server -> client:
//     "presence:state" { peers: Peer[] }    // current peers on this board
//     "presence:join"  Peer
//     "presence:leave" { id }
//     "presence:cursor"{ id, x, y }
//
// State is purely in-memory (cursors are ephemeral; nothing belongs in Mongo).
// Per-socket state is held in `socket.data`.
import { Server } from 'socket.io';

const MAX_PEERS_PER_ROOM = 50;

// Socket.io room key for a specific board within a room. Cursors and presence
// broadcasts are addressed to this key so they stay scoped to one board.
function boardKey(roomCode, boardId) {
  return `${roomCode}::${boardId || '_root'}`;
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    // Cursor packets are tiny — keep ping cheap and reconnects fast.
    pingInterval: 20000,
    pingTimeout: 10000,
    maxHttpBufferSize: 1e5, // 100kB; cursors are <100 B so plenty of headroom
  });

  // Index of room peers for cheap lookup. Map<roomCode, Map<socketId, peer>>
  const rooms = new Map();

  function getRoom(code) {
    let m = rooms.get(code);
    if (!m) { m = new Map(); rooms.set(code, m); }
    return m;
  }

  io.on('connection', (socket) => {
    socket.data.roomCode = null;
    socket.data.boardId = null;

    socket.on('init', (payload, ack) => {
      try {
        const roomCode = String(payload?.roomCode || '').trim().toLowerCase();
        const boardId = String(payload?.boardId || '').slice(0, 64) || null;
        const id = String(payload?.identity?.id || '').slice(0, 32);
        const name = String(payload?.identity?.name || '').slice(0, 24).trim() || 'Anonymous';
        const color = /^#[0-9a-fA-F]{6}$/.test(payload?.identity?.color || '')
          ? payload.identity.color
          : '#D97435';
        if (!roomCode || !id) {
          if (typeof ack === 'function') ack({ error: 'invalid_init' });
          return;
        }

        const peers = getRoom(roomCode);
        if (peers.size >= MAX_PEERS_PER_ROOM) {
          if (typeof ack === 'function') ack({ error: 'room_full' });
          return;
        }

        const peer = { id, name, color, boardId, socketId: socket.id };
        peers.set(socket.id, peer);
        socket.data.roomCode = roomCode;
        socket.data.boardId = boardId;
        socket.data.peer = peer;
        socket.join(boardKey(roomCode, boardId));

        // Send existing peers on THIS board (excluding self) to the newcomer.
        const others = Array.from(peers.values())
          .filter((p) => p.socketId !== socket.id && p.boardId === boardId)
          .map(({ socketId: _s, boardId: _b, ...rest }) => rest);
        if (typeof ack === 'function') ack({ ok: true, peers: others });

        // Tell others on the same board that the newcomer arrived.
        socket.to(boardKey(roomCode, boardId)).emit('presence:join', { id, name, color });
      } catch (e) {
        if (typeof ack === 'function') ack({ error: e.message });
      }
    });

    // The user navigated to a different board within the same room. Move them
    // out of the old board's presence group and into the new one.
    socket.on('board', (payload) => {
      const roomCode = socket.data.roomCode;
      const peer = socket.data.peer;
      if (!roomCode || !peer) return;
      const nextBoardId = String(payload?.boardId || '').slice(0, 64) || null;
      if (nextBoardId === socket.data.boardId) return;

      const oldKey = boardKey(roomCode, socket.data.boardId);
      socket.to(oldKey).emit('presence:leave', { id: peer.id });
      socket.leave(oldKey);

      socket.data.boardId = nextBoardId;
      peer.boardId = nextBoardId;
      const newKey = boardKey(roomCode, nextBoardId);
      socket.join(newKey);
      socket.to(newKey).emit('presence:join', { id: peer.id, name: peer.name, color: peer.color });

      // Send the mover the peers already on the destination board.
      const peers = rooms.get(roomCode);
      const others = peers
        ? Array.from(peers.values())
            .filter((p) => p.socketId !== socket.id && p.boardId === nextBoardId)
            .map(({ socketId: _s, boardId: _b, ...rest }) => rest)
        : [];
      socket.emit('presence:state', { peers: others });
    });

    socket.on('cursor', (payload) => {
      const room = socket.data.roomCode;
      const peer = socket.data.peer;
      if (!room || !peer) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Broadcast only to peers on the same board — never echo to sender.
      socket.to(boardKey(room, socket.data.boardId)).volatile.emit('presence:cursor', { id: peer.id, x, y });
    });

    function leave() {
      const room = socket.data.roomCode;
      const peer = socket.data.peer;
      if (!room || !peer) return;
      const peers = rooms.get(room);
      if (peers) {
        peers.delete(socket.id);
        if (peers.size === 0) rooms.delete(room);
      }
      socket.to(boardKey(room, socket.data.boardId)).emit('presence:leave', { id: peer.id });
      socket.data.roomCode = null;
      socket.data.boardId = null;
      socket.data.peer = null;
    }

    socket.on('leave', leave);
    socket.on('disconnect', leave);
  });

  return io;
}
