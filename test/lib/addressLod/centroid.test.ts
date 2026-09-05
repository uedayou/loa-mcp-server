import { describe, expect, it } from "vitest";
import { computeCentroid } from "../../../src/geo/centroid.js";
import type { GeoJsonGeometry } from "../../../src/geo/wkt.js";

describe("computeCentroid", () => {
  it("returns a Point's own coordinates", () => {
    const point: GeoJsonGeometry = { type: "Point", coordinates: [139.7, 35.6] };
    expect(computeCentroid(point)).toEqual([139.7, 35.6]);
  });

  it("returns the exact center of an axis-aligned rectangle Polygon", () => {
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    const [lon, lat] = computeCentroid(geometry);
    expect(lon).toBeCloseTo(5);
    expect(lat).toBeCloseTo(5);
  });

  it("computes the true area-weighted centroid, not a naive average of ring vertices", () => {
    // Triangle (0,0)-(12,0)-(0,9) with an extra collinear point M=(6,0)
    // injected on the AB edge. M doesn't change the triangle's shape/area at
    // all, so the correct (area-weighted) centroid is still the average of
    // the 3 true corners: (4,3). A naive average of all 4 ring points would
    // instead be skewed by M to (4.5, 2.25) — this test would fail under
    // that (incorrect) approach.
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [6, 0], // collinear midpoint of the (0,0)-(12,0) edge
          [12, 0],
          [0, 9],
          [0, 0],
        ],
      ],
    };
    const [lon, lat] = computeCentroid(geometry);
    expect(lon).toBeCloseTo(4);
    expect(lat).toBeCloseTo(3);
  });

  it("falls back to the vertex average for a degenerate (zero-area) ring", () => {
    // All points collinear on the x-axis: area is exactly 0.
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [10, 0],
          [0, 0],
        ],
      ],
    };
    const [lon, lat] = computeCentroid(geometry);
    expect(Number.isFinite(lon)).toBe(true);
    expect(Number.isFinite(lat)).toBe(true);
    expect(lat).toBeCloseTo(0);
  });

  it("uses the centroid of the largest-area polygon in a MultiPolygon", () => {
    const bigSquare = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const tinySquareFarAway = [
      [500, 500],
      [501, 500],
      [501, 501],
      [500, 501],
      [500, 500],
    ];
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [[tinySquareFarAway], [bigSquare]],
    };
    const [lon, lat] = computeCentroid(geometry);
    // Center of the big square (50,50), not the tiny far-away one (~500.5,500.5).
    expect(lon).toBeCloseTo(50);
    expect(lat).toBeCloseTo(50);
  });
});
