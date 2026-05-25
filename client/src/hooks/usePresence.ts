import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Identity } from '../lib/identity';

export interface Peer {
  id: string;
  name: string;
  color: string;
  /** Most recent world-space cursor position, or null if not yet seen. */
  x: number | null;
  y: number | null;
}

interface UsePresenceResult {
  peers: Peer[];
  /** Send our local cursor position (world coords). Throttled by caller. */
  sendCursor: (x: number, y: number) => void;
  connected: boolean;
}

export function usePresence(
  roomCode: string | undefined,
  identity: Identity | null,
  boardId: string | undefined,
): UsePresenceResult {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  // Latest board, read inside the connect handler so `init` carries the board
  // the user is actually on without re-creating the socket on every nav.
  const boardIdRef = useRef<string | undefined>(boardId);
  boardIdRef.current = boardId;
  // Buffer cursors via a ref so we can flush at most once per animation frame
  // — guards against React state churn from a 30Hz remote-cursor stream.
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const flushScheduled = useRef(false);

  function flushPeers() {
    flushScheduled.current = false;
    setPeers(Array.from(peersRef.current.values()));
  }
  function scheduleFlush() {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    requestAnimationFrame(flushPeers);
  }

  useEffect(() => {
    if (!roomCode || !identity) return;
    // Same-origin in production, fall back to whatever Vite proxy is set up.
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(
        'init',
        { roomCode, boardId: boardIdRef.current, identity },
        (resp: { ok?: true; peers?: Peer[]; error?: string }) => {
          if (resp?.error) {
            console.warn('[presence] init rejected:', resp.error);
            return;
          }
          peersRef.current.clear();
          for (const p of resp.peers ?? []) {
            peersRef.current.set(p.id, { ...p, x: null, y: null });
          }
          scheduleFlush();
        },
      );
    });

    socket.on('disconnect', () => {
      setConnected(false);
      peersRef.current.clear();
      scheduleFlush();
    });

    // Full peer-list reset — sent after switching boards so the cursor layer
    // shows exactly who's on the new board (and nobody from the old one).
    socket.on('presence:state', ({ peers: list }: { peers: Omit<Peer, 'x' | 'y'>[] }) => {
      peersRef.current.clear();
      for (const p of list ?? []) {
        peersRef.current.set(p.id, { ...p, x: null, y: null });
      }
      scheduleFlush();
    });

    socket.on('presence:join', (peer: Omit<Peer, 'x' | 'y'>) => {
      peersRef.current.set(peer.id, { ...peer, x: null, y: null });
      scheduleFlush();
    });

    socket.on('presence:leave', ({ id }: { id: string }) => {
      peersRef.current.delete(id);
      scheduleFlush();
    });

    socket.on('presence:cursor', ({ id, x, y }: { id: string; x: number; y: number }) => {
      const p = peersRef.current.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      scheduleFlush();
    });

    return () => {
      socket.emit('leave');
      socket.close();
      socketRef.current = null;
      peersRef.current.clear();
      setPeers([]);
      setConnected(false);
    };
  }, [roomCode, identity?.id, identity?.name, identity?.color]);

  // Tell the server when we move to a different board so presence re-scopes.
  // The `init` handler already covers the very first board; this fires on
  // subsequent navigations without tearing down the socket. Clearing peers
  // locally avoids a flash of stale cursors before `presence:state` lands.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    peersRef.current.clear();
    scheduleFlush();
    socket.emit('board', { boardId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  function sendCursor(x: number, y: number) {
    socketRef.current?.emit('cursor', { x, y });
  }

  return { peers, sendCursor, connected };
}
