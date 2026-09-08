/**
 * Grid packing.
 *
 * Spans come from each image's aspect ratio, normalized on area so a 1:1 image
 * isn't dwarfed by a 16:9 one. Because CSS `grid-auto-flow: dense` can only
 * backfill a hole with a *later* item that fits, document order decides how
 * many holes the grid ends up with -- so the browser's placement algorithm is
 * simulated here and the order is searched to pack it tightly.
 *
 * This runs at build time only; the app ships the resulting order.
 */

export type Shape = [cols: number, rows: number];
export type Weight = [ncols: number, weight: number];

/** (min viewport width, column count), widest first. */
export const TIERS: Array<[number, number]> = [
  [1080, 12],
  [720, 9],
  [0, 6],
];

/** Sections small enough for an exact search get one; the rest are annealed. */
export const PERM_BUDGET = 50_000;

/**
 * Round half to even: 4.5 becomes 4, not 5.
 *
 * `narrow()` divides small integers and lands on exact halves, where this and
 * Math.round disagree. The published layout was computed with this rule, so
 * swapping it would silently reshape tiles across the whole gallery.
 */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac > 0.5) return floor + 1;
  if (frac < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Map an aspect ratio to (columns, rows) covering roughly `area` cells.
 * At the default area of 12, a 4:3 image lands exactly on span 4 / span 3.
 */
export function spans(ratio: number, area: number, lo: number, hi: number): Shape {
  const cols = Math.min(hi, Math.max(lo, roundHalfEven(Math.sqrt(area * ratio))));
  const rows = Math.min(hi, Math.max(lo, roundHalfEven(Math.sqrt(area / ratio))));
  return [cols, rows];
}

/**
 * Refit a shape for the narrowest tier so widths tile the row exactly. At 6
 * columns a 4- or 5-wide tile always strands a pocket too small to fill, so
 * every image is rounded to a half row or a full one.
 */
export function narrow([c, r]: Shape, ncols: number): Shape {
  const target = c <= 4 ? 3 : ncols;
  return [target, Math.max(1, roundHalfEven((r * target) / c))];
}

/**
 * Simulate `grid-auto-flow: dense` row-major placement.
 * Rows are column bitmasks, so testing a candidate slot is a few integer ANDs.
 */
export function place(shapes: Shape[], ncols: number): { rows: number; filled: number } {
  const rows: number[] = [];
  let filled = 0;

  for (const shape of shapes) {
    const c = Math.min(shape[0], ncols);
    const r = shape[1];
    const block = (1 << c) - 1;
    const stops = ncols - c + 1;

    for (let row = 0; ; row++) {
      while (rows.length < row + r) rows.push(0);
      // OR the spanned rows once, then test each column against that.
      let merged = rows[row];
      for (let dr = 1; dr < r; dr++) merged |= rows[row + dr];

      let placed = false;
      for (let col = 0; col < stops; col++) {
        const mask = block << col;
        if ((merged & mask) === 0) {
          for (let dr = 0; dr < r; dr++) rows[row + dr] |= mask;
          filled += c * r;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }
  return { rows: rows.length, filled };
}

export function fillRate(shapes: Shape[], ncols: number): number {
  const { rows, filled } = place(shapes, ncols);
  return rows ? filled / (rows * ncols) : 1;
}

export type Packable = { shape: Shape };

/** Mean fill across the tiers, weighted toward the widest. */
export function score(order: readonly Packable[], weights: Weight[]): number {
  const smallest = TIERS[TIERS.length - 1][1];
  let total = 0;
  let divisor = 0;
  for (const [ncols, weight] of weights) {
    const shapes = order.map((i) =>
      ncols === smallest ? narrow(i.shape, ncols) : i.shape,
    );
    total += weight * fillRate(shapes, ncols);
    divisor += weight;
  }
  return total / divisor;
}

/** mulberry32 -- small, seedable, and good enough for a hill climb. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reorder images to minimize grid holes, weighted toward the widest tier. */
export function anneal<T extends Packable>(
  items: T[],
  weights: Weight[],
  iters: number,
  seed: number,
): T[] {
  const n = items.length;
  if (n < 3 || iters <= 0) return items;

  const rand = rng(seed);
  const pick = () => Math.floor(rand() * n);

  let cur = items.slice();
  let best = cur;
  let cs = score(cur, weights);
  let bs = cs;

  for (let step = 0; step < iters; step++) {
    const temp = 0.01 * (1 - step / iters) + 0.0005;
    const cand = cur.slice();
    const i = pick();
    const j = pick();
    if (rand() < 0.5) {
      [cand[i], cand[j]] = [cand[j], cand[i]];
    } else {
      cand.splice(j, 0, ...cand.splice(i, 1));
    }
    const s = score(cand, weights);
    if (s >= cs || rand() < Math.exp((s - cs) / temp)) {
      cur = cand;
      cs = s;
      if (s > bs) {
        best = cand.slice();
        bs = s;
      }
    }
  }
  return best;
}

function factorial(n: number): number {
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

/** Every permutation in lexicographic index order, matching itertools. */
function* permutations<T>(items: T[]): Generator<T[]> {
  const n = items.length;
  const idx = items.map((_, i) => i);
  yield idx.map((i) => items[i]);
  for (;;) {
    let i = n - 2;
    while (i >= 0 && idx[i] >= idx[i + 1]) i--;
    if (i < 0) return;
    let j = n - 1;
    while (idx[j] <= idx[i]) j--;
    [idx[i], idx[j]] = [idx[j], idx[i]];
    for (let lo = i + 1, hi = n - 1; lo < hi; lo++, hi--) {
      [idx[lo], idx[hi]] = [idx[hi], idx[lo]];
    }
    yield idx.map((i2) => items[i2]);
  }
}

/** Pack one section: exhaustively when the permutations are few, else annealed. */
export function bestOrder<T extends Packable>(
  group: T[],
  weights: Weight[],
  iters: number,
  seed: number,
): { order: T[]; how: "exact" | "annealed" } {
  if (group.length < 3) return { order: group, how: "exact" };

  if (factorial(group.length) <= PERM_BUDGET) {
    let best = group;
    let bs = -Infinity;
    for (const cand of permutations(group)) {
      const s = score(cand, weights);
      // Strictly greater, so a tie keeps the earlier permutation.
      if (s > bs) {
        bs = s;
        best = cand;
      }
    }
    return { order: best, how: "exact" };
  }
  return { order: anneal(group, weights, iters, seed), how: "annealed" };
}
