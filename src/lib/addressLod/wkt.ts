import { AddressLodError } from "./errors.js";

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

// Converts a WKT POLYGON/MULTIPOLYGON/POINT literal (as found in `geosp:asWKT`)
// into a GeoJSON geometry. WKT's parenthesis nesting maps directly onto
// GeoJSON's coordinate array nesting (Polygon = 2 levels [ring -> position],
// MultiPolygon = 3 levels [polygon -> ring -> position]), so a single
// paren-tracking scan handles both without type-specific branching, and
// naturally supports interior rings (holes) even though the live dataset
// doesn't currently have any.
export function wktToGeoJson(wkt: string): GeoJsonGeometry {
  const match = wkt.match(/^\s*(MULTIPOLYGON|POLYGON|POINT)\s*(\(.*\))\s*$/s);
  if (!match) {
    throw new AddressLodError(`Unsupported WKT: ${wkt.slice(0, 50)}...`);
  }
  const [, type, body] = match;

  if (type === "POINT") {
    const coords = body.slice(1, -1).trim().split(/\s+/).map(Number);
    if (coords.length !== 2 || coords.some(Number.isNaN)) {
      throw new AddressLodError(`Malformed WKT POINT: ${wkt.slice(0, 50)}...`);
    }
    return { type: "Point", coordinates: coords };
  }

  const coordinates = parseNestedCoordinates(body);
  return type === "MULTIPOLYGON"
    ? { type: "MultiPolygon", coordinates: coordinates as number[][][][] }
    : { type: "Polygon", coordinates: coordinates as number[][][] };
}

function parseNestedCoordinates(text: string): unknown {
  const root: unknown[] = [];
  const stack: unknown[][] = [root];
  let buf = "";

  const flushLeaf = () => {
    if (!buf.trim()) return;
    const point = buf.trim().split(/\s+/).map(Number);
    if (point.length !== 2 || point.some(Number.isNaN)) {
      throw new AddressLodError(`Malformed WKT coordinate: "${buf.trim()}"`);
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
        throw new AddressLodError("Unbalanced parentheses in WKT");
      }
      stack.pop();
    } else if (ch === ",") {
      flushLeaf();
    } else {
      buf += ch;
    }
  }

  if (stack.length !== 1 || root.length === 0) {
    throw new AddressLodError("Unbalanced parentheses in WKT");
  }
  return root[0];
}
