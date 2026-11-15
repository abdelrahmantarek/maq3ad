/** Arc-length parameterisation of an axis-aligned ellipse in the XZ plane. */
export interface EllipseTable {
  a: number;
  b: number;
  length: number;
  /** cum[i] = arc length from t=0 to t=i*2π/n; cum[n] = full length. */
  cum: Float64Array;
  n: number;
}

export interface ArcPoint {
  x: number;
  z: number;
  /** Ellipse parameter angle. */
  t: number;
  /** Outward unit normal. */
  nx: number;
  nz: number;
}

export function buildEllipseTable(a: number, b: number, n = 1440): EllipseTable {
  const cum = new Float64Array(n + 1);
  let px = a;
  let pz = 0;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = a * Math.cos(t);
    const z = b * Math.sin(t);
    cum[i] = cum[i - 1] + Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return { a, b, length: cum[n], cum, n };
}

export function ellipsePoint(a: number, b: number, t: number): ArcPoint {
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Gradient of x²/a² + z²/b² is (x/a², z/b²) ∝ (b·cos t, a·sin t).
  let nx = b * c;
  let nz = a * s;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  return { x: a * c, z: b * s, t, nx, nz };
}

/** Point at arc length s (wraps around the full circumference). */
export function pointAtArc(table: EllipseTable, s: number): ArcPoint {
  const { cum, n, length } = table;
  let d = s % length;
  if (d < 0) d += length;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  const t = ((lo + (d - cum[lo]) / span) / n) * Math.PI * 2;
  return ellipsePoint(table.a, table.b, t);
}
