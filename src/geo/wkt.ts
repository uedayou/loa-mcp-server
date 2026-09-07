import { LodError } from "../core/errors.js";

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

// Converts a WKT literal (as found in `geosp:asWKT`) into a GeoJSON geometry.
// WKT's parenthesis nesting maps directly onto GeoJSON's coordinate array
// nesting, so a single paren-tracking scan handles every polygonal/linear
// type without type-specific branching:
//   LINESTRING      = 1 level  [position]
//   MULTILINESTRING = 2 levels [line -> position]        (also Polygon's shape)
//   POLYGON         = 2 levels [ring -> position]
//   MULTIPOLYGON    = 3 levels [polygon -> ring -> position]
// Interior rings (holes) fall out naturally even though the 住所LOD dataset
// has none. LINESTRING/MULTILINESTRING are not produced by 住所LOD but are
// supported so a forked profile for a line-based dataset (routes, tracks…)
// can reuse this parser and the geo/ pipeline unchanged.
export function wktToGeoJson(wkt: string): GeoJsonGeometry {
  const match = wkt.match(
    /^\s*(MULTIPOLYGON|MULTILINESTRING|POLYGON|LINESTRING|POINT)\s*(\(.*\))\s*$/s
  );
  if (!match) {
    throw new LodError(`Unsupported WKT: ${wkt.slice(0, 50)}...`);
  }
  const [, type, body] = match;

  if (type === "POINT") {
    const coords = body.slice(1, -1).trim().split(/\s+/).map(Number);
    if (coords.length !== 2 || coords.some(Number.isNaN)) {
      throw new LodError(`Malformed WKT POINT: ${wkt.slice(0, 50)}...`);
    }
    return { type: "Point", coordinates: coords };
  }

  const coordinates = parseNestedCoordinates(body);
  switch (type) {
    case "MULTIPOLYGON":
      return { type: "MultiPolygon", coordinates: coordinates as number[][][][] };
    case "POLYGON":
      return { type: "Polygon", coordinates: coordinates as number[][][] };
    case "MULTILINESTRING":
      return { type: "MultiLineString", coordinates: coordinates as number[][][] };
    default: // LINESTRING
      return { type: "LineString", coordinates: coordinates as number[][] };
  }
}

function parseNestedCoordinates(text: string): unknown {
  const root: unknown[] = [];
  const stack: unknown[][] = [root];
  let buf = "";

  const flushLeaf = () => {
    if (!buf.trim()) return;
    const point = buf.trim().split(/\s+/).map(Number);
    if (point.length !== 2 || point.some(Number.isNaN)) {
      throw new LodError(`Malformed WKT coordinate: "${buf.trim()}"`);
    }
    stack[stack.length - 1].push(point);
    buf = "";
  };

  for (const ch of text) {
    if (ch === "(") {
      const next: unknown[] = [];
      stack[stack.length - 1].push(next);
      stack.push(next);
    } else if (ch === ")") {
      flushLeaf();
      if (stack.length === 1) {
        throw new LodError("Unbalanced parentheses in WKT");
      }
      stack.pop();
    } else if (ch === ",") {
      flushLeaf();
    } else {
      buf += ch;
    }
  }

  if (stack.length !== 1 || root.length === 0) {
    throw new LodError("Unbalanced parentheses in WKT");
  }
  return root[0];
}
