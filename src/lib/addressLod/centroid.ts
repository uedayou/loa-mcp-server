import type { GeoJsonGeometry } from "./wkt.js";

// Signed area (shoelace formula) of a closed ring, in coordinate-degree^2
// units. Sign indicates winding order; only the magnitude matters here.
function signedRingArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// Area-weighted centroid ("center of mass") of a closed ring, via the
// standard polygon centroid formula. Falls back to the arithmetic mean of
// the ring's vertices when the ring is degenerate (zero area, e.g. a
// self-touching or collinear ring) to avoid dividing by zero.
function ringCentroid(ring: number[][]): [number, number] {
  const area = signedRingArea(ring);
  if (Math.abs(area) < 1e-12) {
    const points = ring.slice(0, -1); // drop the closing duplicate of the first point
    const [sumX, sumY] = points.reduce(
      ([ax, ay], [x, y]) => [ax + x, ay + y],
      [0, 0]
    );
    return [sumX / points.length, sumY / points.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

// Picks whichever polygon (in a MultiPolygon's polygon list) has the
// largest exterior-ring area. A Polygon here is [ring, ...] with ring[0]
// being the exterior ring; 住所LODの実データに内輪(穴)は存在しないため
// (docs/design-ttl-conversion.md 参照)、exterior ringだけを見れば十分。
function largestPolygon(polygons: number[][][][]): number[][][] {
  let best = polygons[0];
  let bestArea = Math.abs(signedRingArea(best[0]));
  for (const polygon of polygons.slice(1)) {
    const area = Math.abs(signedRingArea(polygon[0]));
    if (area > bestArea) {
      best = polygon;
      bestArea = area;
    }
  }
  return best;
}

// Computes a representative [lon, lat] point for a geometry that has no
// wgs:lat/long of its own — 住所LODは都道府県・市区町村・一部の町丁目レベルの
// エンティティでwgs:lat/longを持たないことを実機確認済み(2026-08-06)。Point
// geometryはそのまま自身の座標を返す。Polygon/MultiPolygonは(MultiPolygonの
// 場合は最大面積のポリゴンの)重心を返す。
export function computeCentroid(geometry: GeoJsonGeometry): [number, number] {
  if (geometry.type === "Point") {
    return geometry.coordinates as [number, number];
  }
  if (geometry.type === "Polygon") {
    return ringCentroid(geometry.coordinates[0]);
  }
  return ringCentroid(largestPolygon(geometry.coordinates)[0]);
}
