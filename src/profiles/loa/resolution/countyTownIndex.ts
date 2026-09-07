import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  findCandidates,
  completeFromIndex,
  type HierarchicalCandidate,
  type HierarchicalCompletion,
} from "./hierarchicalNameIndex.js";

export interface CountyTownCandidate extends HierarchicalCandidate {
  county: string; // e.g. "西多摩郡"
  municipality: string; // county + town, e.g. "西多摩郡瑞穂町"
}

// Static, precomputed lookup: bare town/village name (e.g. "瑞穂町", without
// its county) -> every matching "郡+町" municipality nationwide.
//
// Why static instead of built at runtime: 住所LOD's SPARQL-exposed graph only
// stores the full "郡+町" form of a municipality's label (verified live —
// the per-entity .ttl has an extra bare-name literal value, but the
// SPARQL store does not), so a bare town name can't be resolved via a SPARQL
// query alone. Building this table requires one child-listing query per
// prefecture (47 requests); rather than paying that cost against the shared
// public endpoint on every process start, it was collected once with
// scripts/collect-county-towns.mjs and checked into the repo as data.
// Regenerate it if 住所LOD's municipality boundaries change (administrative
// mergers are rare — this does not need frequent refreshing).
const DATA_PATH = fileURLToPath(new URL("./data/countyTowns.json", import.meta.url));
const INDEX: Record<string, CountyTownCandidate[]> = JSON.parse(readFileSync(DATA_PATH, "utf-8"));

export function findCountyTownCandidates(
  bareTownName: string,
  prefecture?: string
): CountyTownCandidate[] {
  return findCandidates(INDEX, bareTownName, prefecture);
}

export type CountyTownCompletion = HierarchicalCompletion<CountyTownCandidate>;

// Attempts to repair an entity path that omits its county (e.g.
// "東京都瑞穂町" or "東京都瑞穂町高根") into the form 住所LOD actually
// indexes ("東京都西多摩郡瑞穂町" / "東京都西多摩郡瑞穂町高根"). Only ever
// called as a fallback after a direct lookup has already failed — see
// municipalityCompletion.ts for how tools use it.
export function completeCountyTown(entityPath: string): CountyTownCompletion {
  return completeFromIndex(entityPath, INDEX);
}
