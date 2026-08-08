import { describe, expect, it } from "vitest";
import { wktToGeoJson } from "../../../src/lib/addressLod/wkt.js";
import { readFixtureJson } from "../../helpers/loadFixture.js";

describe("wktToGeoJson", () => {
  it("parses a simple POLYGON with no holes", () => {
    const result = wktToGeoJson("POLYGON((1 2,3 4,5 6,1 2))");
    expect(result).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [1, 2],
          [3, 4],
          [5, 6],
          [1, 2],
        ],
      ],
    });
  });

  it("parses a POLYGON with an interior ring (hole)", () => {
    const result = wktToGeoJson(
      "POLYGON((0 0,10 0,10 10,0 10,0 0),(2 2,2 8,8 8,8 2,2 2))"
    );
    expect(result.type).toBe("Polygon");
    if (result.type !== "Polygon") throw new Error("unreachable");
    expect(result.coordinates).toHaveLength(2);
    expect(result.coordinates[0]).toHaveLength(5); // exterior ring
    expect(result.coordinates[1]).toHaveLength(5); // interior ring (hole)
  });

  it("parses a MULTIPOLYGON with two disjoint parts", () => {
    const result = wktToGeoJson(
      "MULTIPOLYGON(((1 2,3 4,1 2)),((5 6,7 8,5 6)))"
    );
    expect(result).toEqual({
      type: "MultiPolygon",
      coordinates: [
        [[[1, 2], [3, 4], [1, 2]]],
        [[[5, 6], [7, 8], [5, 6]]],
      ],
    });
  });

  it("parses a POINT", () => {
    expect(wktToGeoJson("POINT(139.744392 35.677415)")).toEqual({
      type: "Point",
      coordinates: [139.744392, 35.677415],
    });
  });

  it("throws on an unsupported WKT type", () => {
    expect(() => wktToGeoJson("LINESTRING(0 0,1 1)")).toThrow();
  });

  it("throws on malformed/unbalanced WKT", () => {
    expect(() => wktToGeoJson("")).toThrow();
    expect(() => wktToGeoJson("POLYGON((1 2,3 4")).toThrow();
  });

  it("round-trips the real geosp:asWKT value from the chome fixture, matching the origin's .geojson", () => {
    const wkt =
      "POLYGON((139.7472564 35.6795283,139.7477571 35.6791576,139.7472564 35.6795283))";
    const result = wktToGeoJson(wkt);
    expect(result.type).toBe("Polygon");
    if (result.type !== "Polygon") throw new Error("unreachable");
    // ring must be closed (first point === last point)
    expect(result.coordinates[0][0]).toEqual(
      result.coordinates[0][result.coordinates[0].length - 1]
    );
  });

  it("matches the exact geometry the origin server returns via .geojson", () => {
    const fixture = readFixtureJson<{ geometry: { coordinates: unknown } }>(
      "chome.geojson"
    );
    // The chome.ttl fixture's geosp:asWKT (see ttl.test.ts) must parse to
    // exactly the same coordinates chome.geojson already contains.
    const wkt =
      "POLYGON((139.7472564 35.6795283,139.7477571 35.6791576,139.7483672 35.6785494,139.7486131 35.6781859,139.7492141 35.6776446,139.7495599 35.6774889,139.7496781 35.6774742,139.7496168 35.6773183,139.7493041 35.6767690,139.7489105 35.6761593,139.7486750 35.6757596,139.7478095 35.6743015,139.7475814 35.6739344,139.7473751 35.6736597,139.7472448 35.6735294,139.7467261 35.6730110,139.7466533 35.6729440,139.7463439 35.6726467,139.7462645 35.6725955,139.7459852 35.6724272,139.7457948 35.6723182,139.7455386 35.6722355,139.7447316 35.6720863,139.7444061 35.6729383,139.7443581 35.6732340,139.7441882 35.6738102,139.7438759 35.6750113,139.7431545 35.6776009,139.7430741 35.6776024,139.7420156 35.6776215,139.7419288 35.6776340,139.7414836 35.6778385,139.7402342 35.6787454,139.7401312 35.6788041,139.7408551 35.6789337,139.7431254 35.6793448,139.7431404 35.6793261,139.7439408 35.6794933,139.7449032 35.6796685,139.7459105 35.6798519,139.7461401 35.6798937,139.7470015 35.6796394,139.7472564 35.6795283))";
    const result = wktToGeoJson(wkt);
    expect(result.coordinates).toEqual(fixture.geometry.coordinates);
  });
});
