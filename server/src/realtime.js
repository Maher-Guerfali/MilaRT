// Realtime presence channel for live cursors / multi-user presence.
//
// Wire format (all events scoped to a roomCode):
//   client -> server:
//     "init"   { roomCode, identity: { id, name, color } }
//     "cursor" { x, y }                  // world coords; throttled by client
//     "leave"                            // optional explicit leave
//
//   server -> client:
//     "presence:state" { peers: Peer[] }    // sent on join — list of others
//     "presence:join"  Peer
//     "presence:leave" { id }
//     "presence:cursor"{ id, x, y }
//
// State is purely in-memory (cursors are ephemeral; nothing belongs in Mongo).
// Per-socket state is held in `socket.data`.
import { Server } from 'socket.io';

const MAX_PEERS_PER_ROOM = 50;

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

    socket.on('init', (payload, ack) => {
      try {
        const roomCode = String(payload?.roomCode || '').trim().toLowerCase();
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

        const peer = { id, name, color, socketId: socket.id };
        peers.set(socket.id, peer);
        socket.data.roomCode = roomCode;
        socket.data.peer = peer;
        socket.join(roomCode);

        // Send existing peers (excluding self) to the newcomer.
        const others = Array.from(peers.values())
          .filter((p) => p.socketId !== socket.id)
          .map(({ socketId: _s, ...rest }) => rest);
        if (typeof ack === 'function') ack({ ok: true, peers: others });

        // Tell everyone else the newcomer arrived.
        socket.to(roomCode).emit('presence:join', { id, name, color });
      } catch (e) {
        if (typeof ack === 'function') ack({ error: e.message });
      }
    });

    socket.on('cursor', (payload) => {
      const room = socket.data.roomCode;
      const peer = socket.data.peer;
      if (!room || !peer) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Broadcast to others in the same room — never echo to sender.
      socket.to(room).volatile.emit('presence:cursor', { id: peer.id, x, y });
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
      socket.to(room).emit('presence:leave', { id: peer.id });
      socket.data.roomCode = null;
      socket.data.peer = null;
    }

    socket.on('leave', leave);
    socket.on('disconnect', leave);
  });

  return io;
}
