import { describe, expect, it } from "vitest";
import { dropSmallIslands, DEFAULT_MIN_ISLAND_AREA_KM2 } from "../../../src/geo/islandFilter.js";
import type { GeoJsonGeometry } from "../../../src/geo/wkt.js";

// Square ring helper: [lon0,lat0] is the bottom-left corner, side in degrees.
function square(lon0: number, lat0: number, side: number): number[][] {
  return [
    [lon0, lat0],
    [lon0 + side, lat0],
    [lon0 + side, lat0 + side],
    [lon0, lat0 + side],
    [lon0, lat0],
  ];
}

// At ~35°N, side=1 degree is roughly 91km x 111km (~10,000km^2) — comfortably
// above DEFAULT_MIN_ISLAND_AREA_KM2 (0.01km^2). side=0.0005 degree is roughly
// 45m x 55m (~0.0025km^2) — comfortably below it.
const BIG_SIDE = 1;
const TINY_SIDE = 0.0005;

describe("dropSmallIslands", () => {
  it("leaves a plain Polygon untouched (nothing to drop within a single part)", () => {
    const geometry: GeoJsonGeometry = { type: "Polygon", coordinates: [square(139, 35, BIG_SIDE)] };
    const result = dropSmallIslands(geometry);
    expect(result.geometry).toEqual(geometry);
    expect(result.droppedCount).toBe(0);
    expect(result.droppedAreaKm2).toBe(0);
  });

  it("leaves a Point untouched", () => {
    const geometry: GeoJsonGeometry = { type: "Point", coordinates: [139.7, 35.6] };
    const result = dropSmallIslands(geometry);
    expect(result.geometry).toEqual(geometry);
    expect(result.droppedCount).toBe(0);
  });

  it("drops tiny island parts and keeps the large mainland part, collapsing to a Polygon", () => {
    const mainland = square(139, 35, BIG_SIDE);
    const tinyIslandA = square(150, 35, TINY_SIDE);
    const tinyIslandB = square(160, 35, TINY_SIDE);
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[mainland], [tinyIslandA], [tinyIslandB]],
    };

    const result = dropSmallIslands(geometry);

    expect(result.geometry.type).toBe("Polygon");
    if (result.geometry.type !== "Polygon") throw new Error("unreachable");
    expect(result.geometry.coordinates[0]).toEqual(mainland);
    expect(result.droppedCount).toBe(2);
    expect(result.droppedAreaKm2).toBeGreaterThan(0);
    expect(result.droppedAreaKm2).toBeLessThan(0.01); // both tiny islands combined are still well under the threshold
  });

  it("keeps a MultiPolygon as MultiPolygon when 2+ parts survive the threshold", () => {
    const partA = square(139, 35, BIG_SIDE);
    const partB = square(145, 35, BIG_SIDE);
    const tinyIsland = square(150, 35, TINY_SIDE);
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[partA], [partB], [tinyIsland]],
    };

    const result = dropSmallIslands(geometry);

    expect(result.geometry.type).toBe("MultiPolygon");
    if (result.geometry.type !== "MultiPolygon") throw new Error("unreachable");
    expect(result.geometry.coordinates).toHaveLength(2);
    expect(result.droppedCount).toBe(1);
  });

  it("does nothing when every part is above the threshold", () => {
    const partA = square(139, 35, BIG_SIDE);
    const partB = square(145, 35, BIG_SIDE);
    const geometry: GeoJsonGeometry = { type: "MultiPolygon", coordinates: [[partA], [partB]] };

    const result = dropSmallIslands(geometry);

    expect(result.droppedCount).toBe(0);
    expect(result.droppedAreaKm2).toBe(0);
    expect(result.geometry).toEqual(geometry);
  });

  it("respects a custom minAreaKm2 threshold", () => {
    // A mid-sized part (~50km^2) that survives the default threshold
    // (0.01km^2) but should be dropped under a much stricter custom one.
    const midSide = 0.07; // ~0.07*91*111 ≈ 45km^2 at 35°N
    const mainland = square(139, 35, BIG_SIDE);
    const midIsland = square(150, 35, midSide);
    const geometry: GeoJsonGeometry = { type: "MultiPolygon", coordinates: [[mainland], [midIsland]] };

    const withDefault = dropSmallIslands(geometry);
    expect(withDefault.droppedCount).toBe(0);

    const withStricterThreshold = dropSmallIslands(geometry, 100);
    expect(withStricterThreshold.droppedCount).toBe(1);
  });

  it("falls back to the single largest part if every part is somehow below the threshold", () => {
    const smaller = square(139, 35, TINY_SIDE);
    const larger = square(150, 35, TINY_SIDE * 2);
    const geometry: GeoJsonGeometry = { type: "MultiPolygon", coordinates: [[smaller], [larger]] };

    // An absurdly high threshold that would otherwise drop everything.
    const result = dropSmallIslands(geometry, 1_000_000);

    expect(result.geometry.type).toBe("Polygon");
    if (result.geometry.type !== "Polygon") throw new Error("unreachable");
    expect(result.geometry.coordinates[0]).toEqual(larger);
    expect(result.droppedCount).toBe(1);
  });

  it("exports a sensible default threshold", () => {
    expect(DEFAULT_MIN_ISLAND_AREA_KM2).toBeGreaterThan(0);
    expect(DEFAULT_MIN_ISLAND_AREA_KM2).toBeLessThan(1);
  });
});
