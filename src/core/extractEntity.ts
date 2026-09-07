import { Parser, type Quad } from "n3";
import { DereferenceError, EntityNotFoundError } from "./errors.js";
import type { DatasetProfile, ProfileContext, QuadIndex } from "./profile.js";
import type { EntityFeature, EntityProperties, PropertyValue } from "./entityFeature.js";
import { wktToGeoJson, type GeoJsonGeometry } from "../geo/wkt.js";
import { dissolveMultiPolygon } from "../geo/dissolve.js";
import { computeCentroid } from "../geo/centroid.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

type TripleList = { predicate: string; object: { value: string } }[];

// 旧 src/lib/addressLod/ttl.ts の extractFeature を profile 駆動に一般化。
// 挙動は loa プロファイルで従来と完全一致(subjectSelector・propertyMap が
// 同じ判定・同じキー・同じ述語を指し、customExtract を持たないため)。
export function extractEntity(
  profile: DatasetProfile,
  ctx: ProfileContext,
  turtle: string,
  requestedPath: string
): EntityFeature {
  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: ctx.baseUrl }).parse(turtle);
  } catch (error) {
    throw new DereferenceError(`Turtle parse error: ${(error as Error).message}`);
  }

  // subject ごとにトリプルをまとめる。.ttl には子エンティティの断片トリプルも
  // 同居するため、プロパティは1つの subject のトリプルからのみ読む。
  const bySubject: QuadIndex = new Map();
  for (const quad of quads) {
    const list = bySubject.get(quad.subject.value) ?? [];
    list.push({ predicate: quad.predicate.value, object: quad.object });
    bySubject.set(quad.subject.value, list);
  }

  const selected = selectSubject(profile, bySubject, ctx, requestedPath);
  if (!selected) {
    throw new EntityNotFoundError(requestedPath);
  }
  const [subjectIri, triples] = selected;

  const get = (predicate: string): string | undefined =>
    triples.find((t) => t.predicate === predicate)?.object.value;
  const getAll = (predicate: string): string[] =>
    triples.filter((t) => t.predicate === predicate).map((t) => t.object.value);
  const resolveBlankNode = (predicate: string, innerPredicate: string): string | undefined => {
    const bnodeId = get(predicate);
    if (!bnodeId) return undefined;
    return (bySubject.get(bnodeId) ?? []).find((t) => t.predicate === innerPredicate)?.object
      .value;
  };

  const { geometry } = profile.vocab;
  const wkt = get(geometry.wktIri);
  const rawLat = get(geometry.latIri);
  const rawLong = get(geometry.longIri);

  const geom: GeoJsonGeometry | null = wkt
    ? dissolveMultiPolygon(wktToGeoJson(wkt))
    : rawLat && rawLong
      ? { type: "Point", coordinates: [Number(rawLong), Number(rawLat)] }
      : null;

  let lat = rawLat ? Number(rawLat) : undefined;
  let long = rawLong ? Number(rawLong) : undefined;
  let pointSource: "centroid" | undefined;
  if (
    (lat === undefined || long === undefined) &&
    geom &&
    (geom.type === "Polygon" || geom.type === "MultiPolygon")
  ) {
    [long, lat] = computeCentroid(geom);
    pointSource = "centroid";
  }

  // properties のキー順: uri, name, <propertyMap の順>, lat, long, point_source。
  // 旧 ttl.ts と同じ順にすることで出力 JSON の diff を壊さない(§14)。
  const properties: EntityProperties = { uri: subjectIri };
  const name = get(profile.vocab.labelIri);
  if (name !== undefined) properties.name = name;

  for (const [key, binding] of Object.entries(profile.vocab.propertyMap)) {
    let value: PropertyValue | undefined;
    if ("via" in binding) {
      value = resolveBlankNode(binding.predicate, binding.via);
    } else if ("multi" in binding) {
      const all = getAll(binding.predicate);
      value = all.length > 0 ? all : undefined;
    } else if ("transform" in binding) {
      const raw = get(binding.predicate);
      value = raw === undefined ? undefined : binding.transform(raw);
    } else {
      value = get(binding.predicate);
    }
    properties[key] = value;
  }

  properties.lat = lat;
  properties.long = long;
  properties.point_source = pointSource;

  if (profile.customExtract) {
    Object.assign(properties, profile.customExtract(bySubject, subjectIri));
  }

  return { type: "Feature", geometry: geom, properties };
}

function selectSubject(
  profile: DatasetProfile,
  bySubject: QuadIndex,
  ctx: ProfileContext,
  requestedPath: string
): [string, TripleList] | undefined {
  const sel = profile.vocab.subjectSelector;
  const entries: [string, TripleList][] = [...bySubject.entries()];

  if (sel.by === "rdfType") {
    return entries.find(([, triples]) =>
      triples.some((t) => t.predicate === RDF_TYPE && t.object.value === sel.typeIri)
    );
  }
  if (sel.by === "requestedIri") {
    const wantIri = `${ctx.baseUrl}${requestedPath}`;
    return entries.find(([iri]) => iri === wantIri) ?? entries[0];
  }
  // "mostTriples"
  return entries.reduce<[string, TripleList] | undefined>((best, cur) => {
    if (!best || cur[1].length > best[1].length) return cur;
    return best;
  }, undefined);
}
