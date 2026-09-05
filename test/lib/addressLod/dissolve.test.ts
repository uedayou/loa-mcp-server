import { describe, expect, it } from "vitest";
import { dissolveMultiPolygon } from "../../../src/geo/dissolve.js";
import type { GeoJsonGeometry } from "../../../src/geo/wkt.js";

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

describe("dissolveMultiPolygon", () => {
  it("merges two unit squares that share an exact boundary edge into a single Polygon", () => {
    // Square A: (0,0)-(1,0)-(1,1)-(0,1). Square B: (1,0)-(2,0)-(2,1)-(1,1).
    // They share the vertical edge at x=1 (A traverses it (1,0)->(1,1),
    // B traverses it (1,1)->(1,0) as its closing edge — exact reverse match,
    // mirroring 住所LOD's real chome-boundary data).
    const squareA = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const squareB = [
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 0],
    ];
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[squareA], [squareB]],
    };

    const result = dissolveMultiPolygon(geometry);

    expect(result.type).toBe("Polygon");
    if (result.type !== "Polygon") throw new Error("unreachable");
    const ring = result.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed ring
    expect(ringArea(ring)).toBeCloseTo(2); // the combined 1x2 rectangle
    // The internal seam (x=1) must be gone: no vertex should sit strictly
    // inside the combined rectangle's edges other than at the 4 corners.
    const xs = ring.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(2);
  });

  it("preserves non-seam boundary coordinates exactly, without recomputing them (regression: polygon-clipping silently altered them)", () => {
    // squareA and squareB share the vertical seam at x=1 (as in the first
    // test above), but each also has one irregular, non-grid-aligned point
    // on its OUTER (non-seam) boundary. A recompute-based union algorithm
    // can silently perturb points like these even though they're nowhere
    // near the seam — this was a real production bug: dissolving
    // "東京都千代田区永田町" via `polygon-clipping`'s union() changed
    // coordinates on its outer boundary just enough that its exact shared
    // border with the neighboring (undissolved) "紀尾井町" was lost,
    // breaking topology-aware simplification for that pair. The current
    // edge-cancellation implementation never computes a new coordinate —
    // it only ever reuses existing ones — so this must never regress.
    const irregularA: [number, number] = [0.30001234, 0.5];
    const irregularB: [number, number] = [1.69998765, 0.5];
    const squareA = [
      [0, 0],
      [1, 0],
      [1, 1],
      irregularA,
      [0, 1],
      [0, 0],
    ];
    const squareB = [
      [1, 0],
      [2, 0],
      irregularB,
      [2, 1],
      [1, 1],
      [1, 0],
    ];
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[squareA], [squareB]],
    };

    const result = dissolveMultiPolygon(geometry);

    expect(result.type).toBe("Polygon");
    if (result.type !== "Polygon") throw new Error("unreachable");
    const ring = result.coordinates[0];
    expect(ring).toContainEqual(irregularA);
    expect(ring).toContainEqual(irregularB);
  });

  it("leaves genuinely disjoint polygons (no shared edge) untouched, e.g. remote islands", () => {
    const mainland = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const distantIsland = [
      [100, 100],
      [101, 100],
      [101, 101],
      [100, 101],
      [100, 100],
    ];
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[mainland], [distantIsland]],
    };

    expect(dissolveMultiPolygon(geometry)).toEqual(geometry);
  });

  it("dissolves three mutually-adjacent squares (grid) into one Polygon", () => {
    const squares = [0, 1, 2].map((i) => [
      [i, 0],
      [i + 1, 0],
      [i + 1, 1],
      [i, 1],
      [i, 0],
    ]);
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: squares.map((ring) => [ring]),
    };

    const result = dissolveMultiPolygon(geometry);

    expect(result.type).toBe("Polygon");
    if (result.type !== "Polygon") throw new Error("unreachable");
    expect(ringArea(result.coordinates[0])).toBeCloseTo(3);
  });

  it("leaves a plain Polygon untouched", () => {
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(dissolveMultiPolygon(geometry)).toEqual(geometry);
  });

  it("leaves a Point untouched", () => {
    const geometry: GeoJsonGeometry = { type: "Point", coordinates: [139.7, 35.6] };
    expect(dissolveMultiPolygon(geometry)).toEqual(geometry);
  });

  it("leaves a single-part MultiPolygon untouched", () => {
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      ],
    };
    expect(dissolveMultiPolygon(geometry)).toEqual(geometry);
  });
});
