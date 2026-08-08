import type { GeoJsonGeometry } from "./wkt.js";

export const SIMPLIFY_LEVELS = ["none", "low", "medium", "high"] as const;
export type SimplifyLevel = (typeof SIMPLIFY_LEVELS)[number];

// Ramer-Douglas-Peucker tolerance in degrees (WGS84 lon/lat, same unit as the
// coordinates themselves). Chosen from real 住所LOD data (2026-08-06): a
// typical 市区町村-level polygon (東京都新宿区, 1,277 points) reduces to
// ~231/169/50 points at low/medium/high respectively, while very small
// rings (chome/banchi-level polygons) are left untouched by the `<= 4`
// floor below regardless of level. Prefecture-level MULTIPOLYGONs with many
// tiny outlying-island rings (e.g. 東京都, 6,721 rings) hit a floor around
// ~29,000 points no matter how high the tolerance goes, since most of their
// point count comes from rings too small to simplify further — `high` is a
// best-effort ceiling, not a guaranteed cap.
const TOLERANCE_DEG: Record<SimplifyLevel, number> = {
  none: 0,
  low: 0.00005, // ~5m: removes near-duplicate points, minimal visible change
  medium: 0.0002, // ~20m: solid reduction, shape still reads clearly at city scale
  high: 0.001, // ~100m: aggressive, for pathological cases (prefecture-wide polygons)
};

export function simplifyGeometry(
  geometry: GeoJsonGeometry,
  level: SimplifyLevel
): GeoJsonGeometry {
  const tolerance = TOLERANCE_DEG[level];
  if (tolerance <= 0 || geometry.type === "Point") {
    return geometry;
  }
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, tolerance)),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => simplifyRing(ring, tolerance))
    ),
  };
}

export function countGeometryPoints(geometry: GeoJsonGeometry): number {
  if (geometry.type === "Point") return 1;
  if (geometry.type === "Polygon") {
    return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  }
  return geometry.coordinates.reduce(
    (sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0),
    0
  );
}

// A ring needs at least 4 points (3 distinct vertices + the closing
// duplicate of the first) to remain a valid polygon ring, so anything at or
// below that is left as-is.
function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 4) return ring;
  const simplified = douglasPeucker(ring, tolerance);
  // douglasPeucker always keeps the ring's first/last point (which are
  // identical, since WKT rings are closed) as its recursion anchors, so a
  // valid result's length is >= 4; anything less means the whole ring
  // collapsed to its closing pair and must fall back to the original.
  return simplified.length >= 4 ? simplified : ring;
}

function douglasPeucker(points: number[][], tolerance: number): number[][] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist <= tolerance) {
    return [first, last];
  }

  const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
  const right = douglasPeucker(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

// Perpendicular distance from `point` to the infinite line through
// `lineStart`/`lineEnd` (the classic Douglas-Peucker distance measure).
// Falls back to point-to-point distance when the two anchors coincide
// (always true at the top of a closed ring's recursion, where first===last)
// — in that degenerate case this picks the vertex farthest from the anchor
// as the split point, which is the standard way to bootstrap simplification
// of a closed ring.
function perpendicularDistance(
  point: number[],
  lineStart: number[],
  lineEnd: number[]
): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
}
