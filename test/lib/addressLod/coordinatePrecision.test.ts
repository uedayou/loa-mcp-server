import { describe, expect, it } from "vitest";
import {
  roundCoordinate,
  roundGeometry,
  decimalPlacesFor,
} from "../../../src/lib/addressLod/coordinatePrecision.js";
import type { GeoJsonGeometry } from "../../../src/lib/addressLod/wkt.js";

describe("roundCoordinate", () => {
  it("rounds to 6 decimal places", () => {
    expect(roundCoordinate(139.74583243219)).toBe(139.745832);
  });

  it("leaves a value already within 6 decimal places unchanged", () => {
    expect(roundCoordinate(35.7)).toBe(35.7);
  });

  it("passes undefined through unchanged", () => {
    expect(roundCoordinate(undefined)).toBeUndefined();
  });
});

describe("roundGeometry", () => {
  it("rounds a Point's coordinates", () => {
    const geometry: GeoJsonGeometry = { type: "Point", coordinates: [139.74583243219, 35.70296019876] };
    expect(roundGeometry(geometry)).toEqual({ type: "Point", coordinates: [139.745832, 35.70296] });
  });

  it("rounds every coordinate in a Polygon's rings", () => {
    const geometry: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [139.74583243219, 35.70296019876],
          [139.74369014567, 35.70162864321],
          [139.74583243219, 35.70296019876],
        ],
      ],
    };
    const result = roundGeometry(geometry);
    expect(result).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [139.745832, 35.70296],
          [139.74369, 35.701629],
          [139.745832, 35.70296],
        ],
      ],
    });
  });

  it("rounds every coordinate across all parts of a MultiPolygon", () => {
    const geometry: GeoJsonGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[1.123456789, 2.987654321], [3.000000001, 4.5], [1.123456789, 2.987654321]]],
      ],
    };
    const result = roundGeometry(geometry);
    expect(result).toEqual({
      type: "MultiPolygon",
      coordinates: [[[[1.123457, 2.987654], [3, 4.5], [1.123457, 2.987654]]]],
    });
  });

  it("rounds to 5 decimal places when given decimalPlacesFor('high')", () => {
    const geometry: GeoJsonGeometry = { type: "Point", coordinates: [139.74583243219, 35.70296019876] };
    expect(roundGeometry(geometry, decimalPlacesFor("high"))).toEqual({
      type: "Point",
      coordinates: [139.74583, 35.70296],
    });
  });
});

describe("decimalPlacesFor", () => {
  it("returns 5 for simplify:'high'", () => {
    expect(decimalPlacesFor("high")).toBe(5);
  });

  it.each(["none", "low", "medium", undefined] as const)(
    "returns 6 for simplify:%s",
    (level) => {
      expect(decimalPlacesFor(level)).toBe(6);
    }
  );
});
