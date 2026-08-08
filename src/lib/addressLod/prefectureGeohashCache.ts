import { config } from "../../config.js";
import { executeSparqlQuery } from "./sparql.js";
import { GEOHASH_NS } from "./vocab.js";

export interface PrefectureGeo {
  uri: string;
  label: string;
  geohash: string;
}

let cache: { data: PrefectureGeo[]; expiresAt: number } | null = null;

// Fetches all 47 prefectures with their 4-char geohash once and caches them
// in memory (default TTL 24h — the list is effectively static). This is the
// "Stage 1" lookup table for reverse_geocode_address: see
// design-address-mcp.md §5.2.
export async function getPrefectureGeohashes(): Promise<PrefectureGeo[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.data;
  }

  const sparql = `
PREFIX ic:    <http://imi.go.jp/ns/core/rdf#>
PREFIX schema:<http://schema.org/>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?pref ?label ?geo WHERE {
  ?pref a ic:住所型; rdfs:label ?label; schema:geo ?geo.
  FILTER NOT EXISTS { ?pref ic:市区町村 ?m }
}
LIMIT 60`.trim();

  const rows = await executeSparqlQuery(sparql);
  const data: PrefectureGeo[] = rows.map((row) => ({
    uri: row.pref,
    label: row.label,
    geohash: row.geo.startsWith(GEOHASH_NS) ? row.geo.slice(GEOHASH_NS.length) : row.geo,
  }));

  cache = { data, expiresAt: now + config.addressLod.prefectureCacheTtlMs };
  return data;
}

// Finds the prefecture whose stored (4-char) geohash shares the longest
// prefix with the input point's geohash. Returns null if the best overlap is
// too weak to trust (e.g. because the prefecture's representative point is
// geographically far from the input — this genuinely happens for prefectures
// with non-compact shapes: 東京都's own stored geohash "xjp0" decodes to the
// Ogasawara Islands area, nowhere near central Tokyo's "xn76g..."). Callers
// must treat a match as a fast-path *hint*, not a guarantee, and fall back to
// an unscoped search when the scoped attempt comes back empty.
const MIN_TRUSTED_OVERLAP = 3;

export function findBestPrefectureMatch(
  inputGeohash: string,
  prefectures: PrefectureGeo[]
): PrefectureGeo | null {
  let best: PrefectureGeo | null = null;
  let bestOverlap = 0;

  for (const pref of prefectures) {
    let overlap = 0;
    while (
      overlap < pref.geohash.length &&
      overlap < inputGeohash.length &&
      pref.geohash[overlap] === inputGeohash[overlap]
    ) {
      overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = pref;
    }
  }

  return bestOverlap >= MIN_TRUSTED_OVERLAP ? best : null;
}

// Test-only: clears the module-level cache so tests can control cache state.
export function resetPrefectureGeohashCacheForTests(): void {
  cache = null;
}
