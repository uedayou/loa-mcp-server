import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  findCandidates,
  completeFromIndex,
  type HierarchicalCandidate,
  type HierarchicalCompletion,
} from "./hierarchicalNameIndex.js";

export interface DesignatedCityWardCandidate extends HierarchicalCandidate {
  city: string; // e.g. "横浜市"
  ward: string; // e.g. "南区"
  municipality: string; // city + ward, e.g. "横浜市南区"
}

// Static, precomputed lookup: bare ward name (e.g. "南区", without its
// designated city) -> every matching "市+区" ward nationwide, for Japan's 20
// ordinance-designated cities (政令指定都市).
//
// Same rationale as countyTownIndex.ts: addresses of the form
// "都道府県+市+区+町" are sometimes written with the city name omitted
// ("都道府県+区+町"), which the URI pattern
// `{都道府県}{政令市}{行政区}{町丁目}` can't resolve directly — this is
// structurally the same problem as the 郡 omission case, just one level
// deeper. Collected once with scripts/collect-designated-city-wards.mjs.
//
// Ward names collide far more than county-town names do (171 wards / 112
// unique bare names) — e.g. "南区" alone exists in 12 different cities, and
// 神奈川県 even has two designated cities (横浜市, 相模原市) that both have
// a "南区" and a "緑区", so prefecture scoping alone doesn't always
// disambiguate. See countyTownIndex's "泊村" case for the same pattern.
const DATA_PATH = fileURLToPath(new URL("./data/designatedCityWards.json", import.meta.url));
const INDEX: Record<string, DesignatedCityWardCandidate[]> = JSON.parse(
  readFileSync(DATA_PATH, "utf-8")
);

export function findDesignatedCityWardCandidates(
  bareWardName: string,
  prefecture?: string
): DesignatedCityWardCandidate[] {
  return findCandidates(INDEX, bareWardName, prefecture);
}

export type DesignatedCityWardCompletion = HierarchicalCompletion<DesignatedCityWardCandidate>;

// Attempts to repair an entity path that omits its designated city (e.g.
// "神奈川県南区" or "神奈川県南区○○町") into the form 住所LOD actually
// indexes ("神奈川県横浜市南区" / ...). Only ever called as a fallback
// after a direct lookup has already failed — see municipalityCompletion.ts.
export function completeDesignatedCityWard(entityPath: string): DesignatedCityWardCompletion {
  return completeFromIndex(entityPath, INDEX);
}
