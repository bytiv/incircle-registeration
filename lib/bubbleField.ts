/**
 * The bubble field's arrangement rule, extracted from the hand-tuned P2/P12
 * composition so new orbs can continue it indefinitely.
 *
 * The 50 seeded bubbles descend in a three-column serpentine — left ≈23%,
 * centre ≈50%, right ≈77%, cycling L → C → R — dropping 22–51px per step
 * (mean ≈38), with every left value inside ±1.25% of its column centre.
 * Measured from the live seed, whose closest hand-tuned pair is 92px
 * centre-to-centre with Ø82px bubbles: the serpentine's geometry is what
 * keeps the field overlap-free, so continuing it needs no distance checks —
 * adjacent columns are ≥93px apart horizontally and a column repeats only
 * every third step (≥102px vertically).
 *
 * Shared by /api/admin/people (positions for host-added walk-ins) and by
 * P12 Connect (the two tail slots the leading company bubbles displace
 * everyone into). Deterministic on purpose: the same inputs give the same
 * slots, so Connect's server render and client hydration agree, and re-runs
 * of the people route are reproducible.
 */

export type PlacedOrb = { bubble_top: number | null; bubble_left: string | null };
export type FieldSlot = { bubble_top: number; bubble_left: string };

/** Column centres measured from the seed: L 22.0–24.5, C 49.0–51.5, R 76.0–78.0. */
const COLUMNS = [23.2, 50.2, 77.0];

/** Which column a stored left% belongs to (boundaries halfway between centres). */
const colOf = (leftPct: number): number => (leftPct < 37 ? 0 : leftPct < 63.5 ? 1 : 2);

/** Tiny deterministic PRNG (mulberry32) — jitter without hydration mismatches. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The next `count` slots along the serpentine, continuing from the lowest
 * positioned orb in `placed` (unpositioned rows are ignored; an empty field
 * starts where the seed starts, top-left at ≈25px).
 */
export function continueField(placed: PlacedOrb[], count: number): FieldSlot[] {
  let anchorTop = -1;
  let anchorLeft: number | null = null;
  for (const orb of placed) {
    if (orb.bubble_top === null || orb.bubble_left === null) continue;
    if (orb.bubble_top > anchorTop) {
      anchorTop = orb.bubble_top;
      anchorLeft = parseFloat(orb.bubble_left);
    }
  }

  // -13 + the first 34–46px step lands ≈25, the seed's own first top.
  let top = anchorTop >= 0 ? anchorTop : -13;
  // Start one column BEFORE the one to emit; an empty field opens on L.
  let col = anchorLeft === null ? 2 : colOf(anchorLeft);
  const rand = mulberry32(anchorTop * 31 + placed.length * 7 + count);

  return Array.from({ length: count }, () => {
    col = (col + 1) % 3;
    top += 34 + Math.round(rand() * 12);
    const left = COLUMNS[col] + (rand() * 2.5 - 1.25);
    return { bubble_top: top, bubble_left: `${left.toFixed(1)}%` };
  });
}

/** What placeFaces() needs to decide the running order. */
export type OrderableFace = PlacedOrb & {
  role: string;
  photo_path: string | null;
  full_name: string;
};

/**
 * The running order of the field, and so of every face-bearing screen.
 *
 * Hosts lead, exactly as the design's team.concat(members) strip always has
 * (design:3280). Then everyone whose photo we actually hold, so the top of the
 * field is faces and the empty glass shells collect at the bottom instead of
 * being sprinkled through it — with 47 of 93 people photo-less, a mixed field
 * reads as broken rather than as incomplete.
 *
 * `photo_path` is the test because it is now truthful: it is set if and only if
 * the file exists in the `faces` bucket (see lib/photos.ts). Give someone a
 * photo in admin → People and they rise to the top on the next roster bump,
 * with no separate flag to maintain.
 *
 * Ties break on the stored bubble_top — monotonic in join order, so the people
 * who were here first stay put — and finally on the name, compared as plain
 * UTF-16 rather than by locale so that Node and the browser cannot disagree and
 * desync hydration.
 */
export function orderFaces<T extends OrderableFace>(faces: T[]): T[] {
  return [...faces].sort((a, b) => {
    const ah = a.role === "host" ? 0 : 1;
    const bh = b.role === "host" ? 0 : 1;
    if (ah !== bh) return ah - bh;
    const ap = a.photo_path ? 0 : 1;
    const bp = b.photo_path ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const at = a.bubble_top ?? Number.MAX_SAFE_INTEGER;
    const bt = b.bubble_top ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.full_name < b.full_name ? -1 : a.full_name > b.full_name ? 1 : 0;
  });
}

/**
 * The field, laid out from scratch for exactly the people standing in it.
 *
 * Position is DERIVED from the running order and never read from the database,
 * which is what lets the composition survive the roster changing on the day:
 * remove someone and everyone below closes up behind them, add someone and the
 * tail simply extends. Before this, `attendees.bubble_top` was the coordinate
 * itself, so a removed person left a permanent hole — 23 removals turned the
 * top of the field into 11 gaps of up to 240px.
 *
 * The stored bubble_top survives only as the stable sequence key that
 * /api/admin/people appends to, and as the tiebreak in orderFaces() above.
 *
 * Deterministic (continueField is seeded, not random), so the server render and
 * the client's post-roster_seq refetch produce byte-identical geometry.
 */
export function placeFaces<T extends OrderableFace>(faces: T[]): T[] {
  const ordered = orderFaces(faces);
  const slots = continueField([], ordered.length);
  return ordered.map((face, i) => ({ ...face, ...slots[i] }));
}
