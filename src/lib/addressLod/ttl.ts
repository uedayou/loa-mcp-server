import { Parser, type Quad } from "n3";
import { config, userAgent } from "../../config.js";
import { normalizeToEntityPath } from "./uri.js";
import { wktToGeoJson, type GeoJsonGeometry } from "./wkt.js";
import { dissolveMultiPolygon } from "./dissolve.js";
import { computeCentroid } from "./centroid.js";
import { AddressLodError, AddressNotFoundError } from "./errors.js";
import {
  PRED,
  RDFS_LABEL,
  GEOSP_AS_WKT,
  WGS_LAT,
  WGS_LONG,
  RDF_TYPE,
  IC_ADDRESS_TYPE,
} from "./vocab.js";

export interface AddressFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: {
    uri: string;
    name?: string;
    address_code?: string;
    prefecture?: string;
    municipality?: string;
    ward?: string;
    town?: string;
    chome?: string;
    banchi?: string;
    notation?: string;
    lat?: number;
    long?: number;
    // "centroid" のときのみ現れる。都道府県・市区町村・一部の町丁目レベルの
    // エンティティはwgs:lat/longを持たないため(実機確認済み)、その場合は
    // ポリゴンの重心で代表点を補完している。省略時(未設定)は住所LOD自身の
    // wgs:lat/longをそのまま使っている。
    point_source?: "centroid";
  };
}

export async function fetchAddressLocation(addressInput: string): Promise<AddressFeature> {
  const entityPath = normalizeToEntityPath(addressInput);
  const url = `${config.addressLod.baseUrl}${encodeURIComponent(entityPath)}.ttl`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.addressLod.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/turtle", "User-Agent": userAgent },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AddressLodError(
        `Request timed out after ${config.addressLod.timeoutMs}ms: ${entityPath}`
      );
    }
    throw new AddressLodError(`Request errored: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new AddressNotFoundError(entityPath);
  }
  if (!response.ok) {
    throw new AddressLodError(
      `Unexpected status ${response.status} ${response.statusText}: ${entityPath}`
    );
  }

  const ttl = await response.text();
  return extractFeature(ttl, entityPath);
}

// n3's Parser.parse(text) — called without a callback — parses synchronously
// and returns the full quad array (verified against @types/n3's overload:
// `parse(input: string, callback?: null): Q[]`).
function parseTurtle(ttl: string): Quad[] {
  try {
    return new Parser({ baseIRI: config.addressLod.baseUrl }).parse(ttl);
  } catch (error) {
    throw new AddressLodError(`Turtle parse error: ${(error as Error).message}`);
  }
}

function extractFeature(ttl: string, requestedEntityPath: string): AddressFeature {
  const quads = parseTurtle(ttl);

  // The .ttl file also carries sibling triples for child entities (e.g.
  // `<...1丁目1> ont:parentFeature <...1丁目>.`), so properties must only be
  // read from triples belonging to one specific subject.
  const bySubject = new Map<string, { predicate: string; object: { value: string } }[]>();
  for (const quad of quads) {
    const list = bySubject.get(quad.subject.value) ?? [];
    list.push({ predicate: quad.predicate.value, object: quad.object });
    bySubject.set(quad.subject.value, list);
  }

  // Which subject is "the" entity? Not necessarily the one whose IRI matches
  // what we requested — 住所LOD's server performs its own ambiguity
  // resolution (e.g. a kanji-numeral request like "…曙三条" is served as the
  // real "…曙3条" entity, verified live), so the response's URI is the
  // authority, not the request path. Sibling/child stub triples in the same
  // file only ever carry a lone `ont:parentFeature` backlink and never their
  // own `a ic:住所型` declaration (verified against every captured fixture),
  // so filtering on that type triple reliably isolates the main entity
  // regardless of which URI the server actually resolved to.
  const [subjectIri, main] =
    [...bySubject.entries()].find(([, triples]) =>
      triples.some((t) => t.predicate === RDF_TYPE && t.object.value === IC_ADDRESS_TYPE)
    ) ?? [];
  if (!subjectIri || !main) {
    throw new AddressNotFoundError(requestedEntityPath);
  }

  const get = (predicate: string) =>
    main.find((t) => t.predicate === predicate)?.object.value;
  const resolveBlankNode = (predicate: string, innerPredicate: string) => {
    const bnodeId = get(predicate);
    if (!bnodeId) return undefined;
    return (bySubject.get(bnodeId) ?? []).find((t) => t.predicate === innerPredicate)
      ?.object.value;
  };

  const wkt = get(GEOSP_AS_WKT);
  const rawLat = get(WGS_LAT);
  const rawLong = get(WGS_LONG);

  const geometry: GeoJsonGeometry | null = wkt
    ? dissolveMultiPolygon(wktToGeoJson(wkt))
    : rawLat && rawLong
      ? { type: "Point", coordinates: [Number(rawLong), Number(rawLat)] }
      : null;

  // 都道府県・市区町村・一部の町丁目レベルのエンティティはwgs:lat/longを
  // 持たない(実機確認済み、2026-08-06)。その場合、ポリゴンの重心
  // (MultiPolygonは最大面積のポリゴンの重心)で代表点を補完する。
  let lat = rawLat ? Number(rawLat) : undefined;
  let long = rawLong ? Number(rawLong) : undefined;
  let pointSource: "centroid" | undefined;
  if ((lat === undefined || long === undefined) && geometry) {
    [long, lat] = computeCentroid(geometry);
    pointSource = "centroid";
  }

  return {
    type: "Feature",
    geometry,
    properties: {
      uri: subjectIri,
      name: get(RDFS_LABEL),
      address_code: resolveBlankNode(PRED.住所コード, PRED.識別値),
      prefecture: get(PRED.都道府県),
      municipality: get(PRED.市区町村),
      ward: get(PRED.区),
      town: get(PRED.町名),
      chome: get(PRED.丁目),
      banchi: get(PRED.番地),
      notation: get(PRED.表記),
      lat,
      long,
      point_source: pointSource,
    },
  };
}
