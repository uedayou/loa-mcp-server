import { describe, expect, it } from "vitest";
import {
  simplifyGeometry,
  countGeometryPoints,
} from "../../../src/geo/simplify.js";
import type { GeoJsonGeometry } from "../../../src/geo/wkt.js";

// A 10x10 square ring with one exactly-collinear midpoint injected on each
// edge. Every injected midpoint has zero perpendicular distance from its
// edge, so any positive tolerance must remove it regardless of level, while
// the four corners (which are not collinear with each other) must survive.
const RECTANGLE_WITH_COLLINEAR_MIDPOINTS: number[][] = [
  [0, 0],
  [0, 5],
  [0, 10],
  [5, 10],
  [10, 10],
  [10, 5],
  [10, 0],
  [5, 0],
  [0, 0],
];
const RECTANGLE_CORNERS_ONLY: number[][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];

describe("simplifyGeometry", () => {
  it("leaves geometry unchanged at level 'none'", () => {
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [RECTANGLE_WITH_COLLINEAR_MIDPOINTS],
    };
    expect(simplifyGeometry(geometry, "none")).toEqual(geometry);
  });

  it.each(["low", "medium", "high"] as const)(
    "removes exactly-collinear midpoints while keeping the corners at level '%s'",
    (level) => {
      const result = simplifyGeometry(
        { type: "Polygon", coordinates: [RECTANGLE_WITH_COLLINEAR_MIDPOINTS] },
        level
      );
      expect(result).toEqual({ type: "Polygon", coordinates: [RECTANGLE_CORNERS_ONLY] });
    }
  );

  it("keeps the ring closed (first point === last point) after simplification", () => {
    const result = simplifyGeometry(
      { type: "Polygon", coordinates: [RECTANGLE_WITH_COLLINEAR_MIDPOINTS] },
      "medium"
    );
    if (result.type !== "Polygon") throw new Error("unreachable");
    const ring = result.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("leaves a Point geometry untouched at every level", () => {
    const point: GeoJsonGeometry = { type: "Point", coordinates: [139.7, 35.6] };
    expect(simplifyGeometry(point, "high")).toEqual(point);
  });

  it("leaves a small ring (<= 4 points) untouched even at high simplification", () => {
    const triangle: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    expect(simplifyGeometry(triangle, "high")).toEqual(triangle);
  });

  it("applies simplification to every ring of every polygon in a MultiPolygon", () => {
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [RECTANGLE_WITH_COLLINEAR_MIDPOINTS],
        [RECTANGLE_WITH_COLLINEAR_MIDPOINTS],
      ],
    };
    const result = simplifyGeometry(geometry, "medium");
    expect(result).toEqual({
      type: "MultiPolygon",
      coordinates: [[RECTANGLE_CORNERS_ONLY], [RECTANGLE_CORNERS_ONLY]],
    });
  });

  // LINESTRING/MULTILINESTRING are not produced by 住所LOD but the geo/
  // pipeline supports them for forked line-based datasets. RDP applies to an
  // open line directly (no closed-ring floor): collinear interior points go,
  // endpoints stay.
  it("drops collinear interior points of a LineString, keeping endpoints", () => {
    const geometry: GeoJsonGeometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 10],
      ],
    };
    expect(simplifyGeometry(geometry, "medium")).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    });
  });

  it("simplifies each part of a MultiLineString independently", () => {
    const geometry: GeoJsonGeometry = {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [10, 0],
        ],
        [
          [0, 0],
          [0, 5],
        ],
      ],
    };
    expect(simplifyGeometry(geometry, "medium")).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [10, 0],
        ],
        [
          [0, 0],
          [0, 5],
        ],
      ],
    });
  });
});

describe("countGeometryPoints", () => {
  it("counts 1 for a Point", () => {
    expect(countGeometryPoints({ type: "Point", coordinates: [0, 0] })).toBe(1);
  });

  it("counts all ring points for a Polygon", () => {
    expect(
      countGeometryPoints({ type: "Polygon", coordinates: [RECTANGLE_WITH_COLLINEAR_MIDPOINTS] })
    ).toBe(9);
  });

  it("counts all ring points across all polygons for a MultiPolygon", () => {
    expect(
      countGeometryPoints({
        type: "MultiPolygon",
        coordinates: [[RECTANGLE_WITH_COLLINEAR_MIDPOINTS], [RECTANGLE_CORNERS_ONLY]],
      })
    ).toBe(14);
  });

  it("counts positions for LineString / MultiLineString", () => {
    expect(
      countGeometryPoints({ type: "LineString", coordinates: [[0, 0], [1, 1], [2, 2]] })
    ).toBe(3);
    expect(
      countGeometryPoints({
        type: "MultiLineString",
        coordinates: [[[0, 0], [1, 1]], [[0, 0], [0, 1], [0, 2]]],
      })
    ).toBe(5);
  });
});
