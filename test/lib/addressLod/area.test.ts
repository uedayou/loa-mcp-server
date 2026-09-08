import { describe, expect, it } from "vitest";
import { calculateAreaKm2, ringAreaKm2 } from "../../../src/geo/area.js";
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

describe("calculateAreaKm2", () => {
  it("returns 0 for a Point (no polygon)", () => {
    const geometry: GeoJsonGeometry = { type: "Point", coordinates: [139.7, 35.6] };
    expect(calculateAreaKm2(geometry)).toBe(0);
  });

  it("matches ringAreaKm2 for a plain Polygon", () => {
    const ring = square(139, 35, 1);
    const geometry: GeoJsonGeometry = { type: "Polygon", coordinates: [ring] };
    expect(calculateAreaKm2(geometry)).toBeCloseTo(ringAreaKm2(ring), 9);
  });

  it("sums every part of a MultiPolygon, including small islands (unlike dropSmallIslands)", () => {
    const mainland = square(139, 35, 1);
    const tinyIsland = square(150, 35, 0.0005); // ~0.0025km^2, well under dropSmallIslands' threshold
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[mainland], [tinyIsland]],
    };

    const total = calculateAreaKm2(geometry);
    const mainlandOnly = ringAreaKm2(mainland);
    const islandOnly = ringAreaKm2(tinyIsland);

    expect(total).toBeCloseTo(mainlandOnly + islandOnly, 9);
    expect(total).toBeGreaterThan(mainlandOnly); // the small island must not be dropped
  });

  it("is larger near the equator than near the poles for the same degree-sized square (cos-latitude correction)", () => {
    const nearEquator = square(139, 1, 1);
    const nearPole = square(139, 80, 1);
    expect(calculateAreaKm2({ type: "Polygon", coordinates: [nearEquator] })).toBeGreaterThan(
      calculateAreaKm2({ type: "Polygon", coordinates: [nearPole] })
    );
  });
});
