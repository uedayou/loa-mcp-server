import { describe, expect, it } from "vitest";
import { simplifyGeometriesTopologically } from "../../../src/lib/addressLod/topologySimplify.js";
import type { GeoJsonGeometry } from "../../../src/lib/addressLod/wkt.js";

function ringsOf(geometry: GeoJsonGeometry | null): number[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

// Counts how many directed edges of `ringsA` have their exact reverse in
// `ringsB` — i.e. how much boundary the two shapes still share.
function sharedEdgeCount(ringsA: number[][][], ringsB: number[][][]): number {
  const edgesA = new Set<string>();
  for (const ring of ringsA) {
    for (let i = 0; i < ring.length - 1; i++) {
      edgesA.add(`${ring[i].join(",")}|${ring[i + 1].join(",")}`);
    }
  }
  let shared = 0;
  for (const ring of ringsB) {
    for (let i = 0; i < ring.length - 1; i++) {
      const reverseKey = `${ring[i + 1].join(",")}|${ring[i].join(",")}`;
      if (edgesA.has(reverseKey)) shared++;
    }
  }
  return shared;
}

function countPoints(geometry: GeoJsonGeometry | null): number {
  return ringsOf(geometry).reduce((sum, ring) => sum + ring.length, 0);
}

// A 10x1 strip built from 3 adjacent unit-width squares (0..1, 1..2, 2..3 on
// the x-axis, further subdivided so each square's shared edges have extra
// collinear points to simplify away), so simplification has real work to do
// while the strip's outer boundary and the two internal seams stay exactly
// representable.
function adjacentSquare(xOffset: number): number[][] {
  return [
    [xOffset, 0],
    [xOffset + 0.5, 0],
    [xOffset + 1, 0],
    [xOffset + 1, 0.5],
    [xOffset + 1, 1],
    [xOffset + 0.5, 1],
    [xOffset, 1],
    [xOffset, 0.5],
    [xOffset, 0],
  ];
}

describe("simplifyGeometriesTopologically", () => {
  it("keeps adjacent polygons' shared boundary perfectly aligned after simplification (no gap)", () => {
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [adjacentSquare(0)] },
      { type: "Polygon", coordinates: [adjacentSquare(1)] },
      { type: "Polygon", coordinates: [adjacentSquare(2)] },
    ];

    for (const level of ["low", "medium", "high"] as const) {
      const { geometries: result } = simplifyGeometriesTopologically(geometries, level);
      // Every adjacent pair (0-1, 1-2) must still share at least one edge —
      // the structural guarantee that no gap was introduced by simplifying
      // each polygon's copy of the shared boundary differently.
      expect(sharedEdgeCount(ringsOf(result[0]), ringsOf(result[1]))).toBeGreaterThan(0);
      expect(sharedEdgeCount(ringsOf(result[1]), ringsOf(result[2]))).toBeGreaterThan(0);
    }
  });

  it("reduces the total point count, more aggressively at higher levels", () => {
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [adjacentSquare(0)] },
      { type: "Polygon", coordinates: [adjacentSquare(1)] },
      { type: "Polygon", coordinates: [adjacentSquare(2)] },
    ];
    const original = geometries.reduce((s, g) => s + countPoints(g), 0);

    const low = simplifyGeometriesTopologically(geometries, "low");
    const high = simplifyGeometriesTopologically(geometries, "high");

    expect(low.originalPoints).toBe(original);
    expect(low.simplifiedPoints).toBeLessThanOrEqual(original);
    expect(high.simplifiedPoints).toBeLessThanOrEqual(low.simplifiedPoints);
  });

  it("leaves Point geometries and nulls untouched, passing them through by position", () => {
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [adjacentSquare(0)] },
      { type: "Point", coordinates: [139.7, 35.6] },
      null,
    ];

    const { geometries: result } = simplifyGeometriesTopologically(geometries, "high");

    expect(result[1]).toEqual({ type: "Point", coordinates: [139.7, 35.6] });
    expect(result[2]).toBeNull();
  });

  it("handles a single polygon (no neighbors to share a boundary with) without error", () => {
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [adjacentSquare(0)] },
    ];
    const { geometries: result } = simplifyGeometriesTopologically(geometries, "high");
    expect(result[0]?.type).toBe("Polygon");
  });

  it("falls back to the original geometry for a polygon that would collapse to a degenerate shape (実データ: 東京都千代田区「神田平河町」でsimplify:'high'適用時に実際に発生)", () => {
    // A big, geometrically complex polygon whose points carry large
    // Visvalingam-Whyatt weight (large effective area), alongside a tiny
    // sliver-shaped polygon confined to a minuscule bounding box (mimicking
    // a genuinely small real-world town). Because topojson-simplify picks
    // one global weight threshold across the whole batch, the tiny
    // polygon's every point can fall below it — collapsing its entire
    // boundary to a single repeated coordinate, exactly as was observed
    // live for 神田平河町 (its simplified ring became 4 identical points).
    const tinySliver = [
      [1000, 1000],
      [1000.00005, 1000],
      [1000.0001, 1000.00002],
      [1000.00005, 1000.00003],
      [1000, 1000],
    ];
    const bigJaggedPolygon: number[][] = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n;
      const radius = 500 + (i % 2 === 0 ? 50 : -50);
      bigJaggedPolygon.push([500 + radius * Math.cos(angle), 500 + radius * Math.sin(angle)]);
    }
    bigJaggedPolygon.push(bigJaggedPolygon[0]);

    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [bigJaggedPolygon] },
      { type: "Polygon", coordinates: [tinySliver] },
    ];

    const { geometries: result } = simplifyGeometriesTopologically(geometries, "high");

    // The tiny polygon must fall back to its untouched original shape
    // rather than collapse into an invalid (zero-area / <3-unique-point) ring.
    expect(result[1]).toEqual({ type: "Polygon", coordinates: [tinySliver] });
    const ring = (result[1] as { type: "Polygon"; coordinates: number[][][] }).coordinates[0];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ring.slice(0, -1).map((p) => p.join(","))).size).toBeGreaterThanOrEqual(3);

    // Sanity check the fallback is scoped to the degenerate polygon only —
    // the big polygon should still actually be simplified.
    expect(countPoints(result[0])).toBeLessThan(countPoints(geometries[0]));
  });

  it("scopes the degenerate fallback to the individual ring, not the whole MultiPolygon (実データ: 東京都港区・品川区・江東区・大田区のような臨海部の区で発生)", () => {
    // 実機で発見した回帰: 港区・品川区・江東区・大田区は埋立地・小島を多数
    // 含むMultiPolygon(江東区は75パーツ)で、そのうちの小さな島1つが
    // simplify:'low'でも退化するだけで、Feature全体を丸ごと元に戻す
    // (旧実装)と区の本体まで簡略化されなくなり、隣接する区との共有境界の
    // 精度が食い違って地図に隙間が生じた。この地域のMultiPolygonを模した
    // ケースで、(a) 本体は正しく簡略化され隣接ポリゴンとの共有境界を保つ
    // こと、(b) 退化する小島だけが元の形状にフォールバックされること、
    // を検証する。
    const neighborWard: number[][] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
      [0, 0],
    ];
    const coastalWardMainland: number[][] = [
      [1, 0],
      [1.5, 0],
      [2, 0],
      [2, 0.5],
      [2, 1],
      [1.5, 1],
      [1, 1],
      [1, 0.5],
      [1, 0],
    ];
    const tinyReclaimedIsland = [
      [1000, 1000],
      [1000.00005, 1000],
      [1000.0001, 1000.00002],
      [1000.00005, 1000.00003],
      [1000, 1000],
    ];

    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [neighborWard] },
      {
        type: "MultiPolygon",
        coordinates: [[coastalWardMainland], [tinyReclaimedIsland]],
      },
    ];

    const { geometries: result } = simplifyGeometriesTopologically(geometries, "low");
    const coastalResult = result[1] as { type: "MultiPolygon"; coordinates: number[][][][] };

    expect(coastalResult.type).toBe("MultiPolygon");
    const [mainRing] = coastalResult.coordinates[0];
    const [islandRing] = coastalResult.coordinates[1];

    // The tiny island must have fallen back to its own valid original shape.
    expect(islandRing).toEqual(tinyReclaimedIsland);

    // The mainland part must still share a boundary with its neighbor — no
    // gap — proving it was NOT discarded back to full precision just
    // because the unrelated island collapsed.
    expect(sharedEdgeCount(ringsOf(result[0]), [mainRing])).toBeGreaterThan(0);
    // And it must have actually been simplified (fewer points than the
    // original 9-point mainland ring), not silently left untouched.
    expect(mainRing.length).toBeLessThan(coastalWardMainland.length);
  });

  it("omits the degenerate part entirely under the 'omit' strategy, instead of falling back to its original shape", () => {
    // Same coastal-ward fixture as above, but this time using
    // degenerateRingStrategy:"omit" — the tiny island must vanish from the
    // output rather than reappear at full precision, and omittedPartCount
    // must report it.
    const neighborWard: number[][] = [
      [0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0, 0],
    ];
    const coastalWardMainland: number[][] = [
      [1, 0], [1.5, 0], [2, 0], [2, 0.5], [2, 1], [1.5, 1], [1, 1], [1, 0.5], [1, 0],
    ];
    const tinyReclaimedIsland = [
      [1000, 1000], [1000.00005, 1000], [1000.0001, 1000.00002], [1000.00005, 1000.00003], [1000, 1000],
    ];

    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Polygon", coordinates: [neighborWard] },
      { type: "MultiPolygon", coordinates: [[coastalWardMainland], [tinyReclaimedIsland]] },
    ];

    const { geometries: result, omittedPartCount } = simplifyGeometriesTopologically(geometries, "low", "omit");

    // Only the mainland part survives -> collapses down to a plain Polygon.
    expect(result[1]?.type).toBe("Polygon");
    expect(omittedPartCount).toBe(1);

    // The surviving mainland must still be properly simplified and still
    // share a boundary with its neighbor (unaffected by the omission).
    expect(sharedEdgeCount(ringsOf(result[0]), ringsOf(result[1]))).toBeGreaterThan(0);
    expect(countPoints(result[1])).toBeLessThan(coastalWardMainland.length);
  });

  it("keeps the largest original part as a safety net if 'omit' would otherwise remove every part of a Feature", () => {
    // Two tiny slivers, both guaranteed to collapse under simplification —
    // there is no "big" part to survive. `omit` must not return an empty
    // geometry; it must fall back to keeping the larger of the two, at its
    // original (pre-simplify) precision.
    const smallerSliver = [
      [1000, 1000], [1000.00003, 1000], [1000.00003, 1000.00003], [1000, 1000.00003], [1000, 1000],
    ];
    const largerSliver = [
      [2000, 2000], [2000.00008, 2000], [2000.00008, 2000.00008], [2000, 2000.00008], [2000, 2000],
    ];
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "MultiPolygon", coordinates: [[smallerSliver], [largerSliver]] },
    ];

    const { geometries: result } = simplifyGeometriesTopologically(geometries, "high", "omit");

    expect(result[0]).not.toBeNull();
    expect(countPoints(result[0])).toBeGreaterThanOrEqual(4);
  });

  it("returns the input unchanged when there is nothing polygonal to simplify", () => {
    const geometries: (GeoJsonGeometry | null)[] = [
      { type: "Point", coordinates: [1, 2] },
      null,
    ];
    const result = simplifyGeometriesTopologically(geometries, "high");
    expect(result.geometries).toEqual(geometries);
    expect(result.simplifiedPoints).toBe(result.originalPoints);
  });
});
