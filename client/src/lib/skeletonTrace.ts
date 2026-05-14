// Client-side handwriting tracer.
//
// Replaces the old potrace pipeline. potrace produced *outline contours*
// (every pen stroke became two parallel lines — the silhouette of the ink),
// which made traced text look hollow and "double-walled". This module
// instead walks the centerline of the ink:
//
//   1. Take a binary mask (0 = bg, 1 = ink) at some manageable resolution.
//   2. Thin it to 1 pixel wide with Zhang-Suen — every pen stroke collapses
//      to the path the pen actually took.
//   3. Walk that skeleton from each endpoint (and any leftover loops),
//      emitting polylines. Junctions split walks.
//   4. Simplify with Douglas-Peucker so the polylines aren't pixel-noisy.
//   5. Estimate pen thickness from ink-area / skeleton-length so the rendered
//      stroke width matches what was on the paper.
//
// All pure JS, no native deps, runs in ~0.5s on a 600px-wide mask.

export interface SkeletonTraceResult {
  /** Each polyline is a flat [x0,y0,x1,y1,...] in the input mask's pixel coords. */
  polylines: number[][];
  /** Estimated pen thickness in mask pixels. */
  inkThickness: number;
  /** The mask resolution the polylines reference. */
  width: number;
  height: number;
}

// Downscale the mask before skeletonization if it's bigger than this. 600 is
// a sweet spot — Zhang-Suen takes O(W·H · iterations) and iterations grow
// with stroke thickness, so doubling the resolution roughly 4×s the work.
const MAX_TRACE_DIM = 600;

/** Trace a binary mask to centerline polylines. `mask` is row-major,
 *  values 0 or 1, length === width * height. */
export function traceSkeleton(
  mask: Uint8Array,
  width: number,
  height: number,
): SkeletonTraceResult {
  const longest = Math.max(width, height);
  if (longest > MAX_TRACE_DIM) {
    const scale = MAX_TRACE_DIM / longest;
    const nw = Math.max(1, Math.round(width * scale));
    const nh = Math.max(1, Math.round(height * scale));
    mask = downscaleMask(mask, width, height, nw, nh);
    width = nw;
    height = nh;
  }

  const inkBefore = countOnes(mask);
  const skeleton = zhangSuenThin(mask, width, height);
  const skelLen = countOnes(skeleton);
  // ink area / centerline length ≈ pen thickness in pixels. Floored at 1 so
  // a single-pixel skeleton doesn't divide-by-zero produce NaN.
  const inkThickness = skelLen > 0 ? Math.max(1, inkBefore / skelLen) : 1;

  const polylines = walkSkeleton(skeleton, width, height);
  // Douglas-Peucker simplification — 0.75px tolerance keeps curves smooth
  // without leaving redundant points along straight runs.
  const simplified = polylines
    .map((p) => simplifyPolyline(p, 0.75))
    .filter((p) => p.length >= 4);

  return { polylines: simplified, inkThickness, width, height };
}

// ── Downsample ────────────────────────────────────────────────────────
// Nearest-neighbour on the mask is fine because the mask is already binary
// and we'd lose nothing meaningful from box-averaging at this point.
function downscaleMask(
  src: Uint8Array, sw: number, sh: number, dw: number, dh: number,
): Uint8Array {
  const dst = new Uint8Array(dw * dh);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * xRatio));
      dst[y * dw + x] = src[sy * sw + sx];
    }
  }
  return dst;
}

function countOnes(buf: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i]) n++;
  return n;
}

// ── Zhang-Suen thinning ───────────────────────────────────────────────
// Classic two-pass parallel thinning. Repeatedly peels boundary pixels off
// the shape until what's left is a 1-pixel-wide skeleton.
//
// Neighbour numbering (Gonzalez & Woods convention):
//   p9 p2 p3
//   p8 p1 p4
//   p7 p6 p5
function zhangSuenThin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const buf = new Uint8Array(mask);
  const toRemove: number[] = [];

  function neighbours(i: number): number[] {
    return [
      buf[i - w],        // p2 (N)
      buf[i - w + 1],    // p3 (NE)
      buf[i + 1],        // p4 (E)
      buf[i + w + 1],    // p5 (SE)
      buf[i + w],        // p6 (S)
      buf[i + w - 1],    // p7 (SW)
      buf[i - 1],        // p8 (W)
      buf[i - w - 1],    // p9 (NW)
    ];
  }
  function transitions(n: number[]): number {
    let t = 0;
    for (let i = 0; i < 8; i++) {
      if (n[i] === 0 && n[(i + 1) & 7] === 1) t++;
    }
    return t;
  }

  let changed = true;
  while (changed) {
    changed = false;

    // Sub-iteration 1: peel from N/E/S boundaries.
    toRemove.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (buf[i] !== 1) continue;
        const n = neighbours(i);
        const b = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7];
        if (b < 2 || b > 6) continue;
        if (transitions(n) !== 1) continue;
        // p2 * p4 * p6 == 0 ⇒ at least one of N, E, S is bg
        if (n[0] && n[2] && n[4]) continue;
        // p4 * p6 * p8 == 0 ⇒ at least one of E, S, W is bg
        if (n[2] && n[4] && n[6]) continue;
        toRemove.push(i);
      }
    }
    if (toRemove.length) {
      for (const i of toRemove) buf[i] = 0;
      changed = true;
    }

    // Sub-iteration 2: peel from S/W/N boundaries (mirror conditions).
    toRemove.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (buf[i] !== 1) continue;
        const n = neighbours(i);
        const b = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7];
        if (b < 2 || b > 6) continue;
        if (transitions(n) !== 1) continue;
        // p2 * p4 * p8 == 0 ⇒ at least one of N, E, W is bg
        if (n[0] && n[2] && n[6]) continue;
        // p2 * p6 * p8 == 0 ⇒ at least one of N, S, W is bg
        if (n[0] && n[4] && n[6]) continue;
        toRemove.push(i);
      }
    }
    if (toRemove.length) {
      for (const i of toRemove) buf[i] = 0;
      changed = true;
    }
  }

  return buf;
}

// ── Skeleton walking ──────────────────────────────────────────────────
// 8-neighbour offsets ordered so straight directions come first — the walker
// prefers to keep going straight at a junction-free pixel.
const N8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],   // E, W, S, N
  [1, 1], [-1, -1], [1, -1], [-1, 1], // diagonals
];

function countNeighbours(skel: Uint8Array, w: number, h: number, x: number, y: number): number {
  let n = 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (skel[ny * w + nx]) n++;
  }
  return n;
}

function walkSkeleton(skel: Uint8Array, w: number, h: number): number[][] {
  // We need to mutate as we walk so we don't revisit. Copy first.
  const buf = new Uint8Array(skel);
  const polylines: number[][] = [];

  // Pass 1: walk from every endpoint (skeleton pixel with exactly 1 neighbour).
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!buf[y * w + x]) continue;
      if (countNeighbours(buf, w, h, x, y) === 1) {
        const poly = walkFrom(buf, w, h, x, y);
        if (poly.length >= 4) polylines.push(poly);
      }
    }
  }

  // Pass 2: anything left is part of a loop (no endpoint). Pick any pixel and
  // walk it out as a closed polyline.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!buf[y * w + x]) continue;
      const poly = walkFrom(buf, w, h, x, y);
      if (poly.length >= 4) polylines.push(poly);
    }
  }

  return polylines;
}

// Walk along the skeleton from (sx, sy) until we hit a junction or run out.
// Erases visited pixels from `buf` so each is emitted exactly once.
function walkFrom(buf: Uint8Array, w: number, h: number, sx: number, sy: number): number[] {
  const out: number[] = [];
  let x = sx, y = sy;
  out.push(x, y);
  buf[y * w + x] = 0;

  while (true) {
    let nx = -1, ny = -1, nc = 0;
    // Prefer straight neighbours over diagonals (matches the order in N8).
    for (const [dx, dy] of N8) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      if (buf[ty * w + tx]) {
        if (nc === 0) { nx = tx; ny = ty; }
        nc++;
      }
    }
    if (nc === 0) break;            // dead end
    // If we're at a junction (>1 unvisited neighbour) stop — caller will pick
    // up the other branches as separate walks once this branch is consumed.
    if (nc > 1) {
      out.push(nx, ny);
      break;
    }
    x = nx; y = ny;
    out.push(x, y);
    buf[y * w + x] = 0;
  }

  return out;
}

// ── Douglas-Peucker simplification ────────────────────────────────────
function simplifyPolyline(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, maxI = -1;
    const ax = pts[a * 2], ay = pts[a * 2 + 1];
    const bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2], py = pts[i * 2 + 1];
      // Perpendicular distance² from (px,py) to line a→b.
      const cross = (px - ax) * dy - (py - ay) * dx;
      const d = (cross * cross) / lenSq;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxI !== -1 && maxD > tol2) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  return out;
}
