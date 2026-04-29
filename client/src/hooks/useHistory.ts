import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_HISTORY = 60;
const COALESCE_MS = 600;

export interface UndoControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
}

// Wrap an externally-owned `current` snapshot with undo/redo. The hook
// observes changes to `current` via effect and pushes the *previous* value
// onto a history stack. `apply` is the way the hook hands control back to
// the parent when undo/redo is invoked.
//
// Same-burst edits inside COALESCE_MS replace the most recent entry instead
// of stacking (so typing 50 chars isn't 50 undo steps).
export function useHistory<T>(
  current: T,
  apply: (snapshot: T) => void,
): UndoControls {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const prev = useRef<T>(current);
  const lastPushAt = useRef(0);
  const skipNext = useRef(false);
  const initialized = useRef(false);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      prev.current = current;
      return;
    }
    if (skipNext.current) {
      // The change came from undo/redo itself — don't record it.
      skipNext.current = false;
      prev.current = current;
      return;
    }
    const now = Date.now();
    if (now - lastPushAt.current >= COALESCE_MS || past.current.length === 0) {
      past.current.push(prev.current);
      if (past.current.length > MAX_HISTORY) past.current.shift();
    }
    // else: within the coalesce window, the existing top of `past` is still
    // the right state to revert to, so we leave it alone.
    future.current = [];
    lastPushAt.current = now;
    prev.current = current;
    rerender();
  }, [current, rerender]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const target = past.current.pop()!;
    future.current.unshift(prev.current);
    skipNext.current = true;
    apply(target);
    rerender();
  }, [apply, rerender]);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    const target = future.current.shift()!;
    past.current.push(prev.current);
    skipNext.current = true;
    apply(target);
    rerender();
  }, [apply, rerender]);

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    prev.current = current;
    lastPushAt.current = 0;
    initialized.current = true;
    rerender();
    // current intentionally not in deps — reset() is only used after a
    // fresh load() and the caller will pass the latest value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerender]);

  return {
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    reset,
  };
}
