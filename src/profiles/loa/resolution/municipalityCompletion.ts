import { completeCountyTown, type CountyTownCandidate } from "./countyTownIndex.js";
import {
  completeDesignatedCityWard,
  type DesignatedCityWardCandidate,
} from "./designatedCityWardIndex.js";
import type { HierarchicalCompletion } from "./hierarchicalNameIndex.js";

export type MunicipalityCandidate = CountyTownCandidate | DesignatedCityWardCandidate;
export type MunicipalityCompletion = HierarchicalCompletion<MunicipalityCandidate>;

// Tries both known "omitted intermediate level" patterns — a county
// ("〇〇郡△△町" written as just "△△町") and a designated city's own name
// ("〇〇市△△区" written as just "△△区") — and returns whichever produces a
// non-"none" result. A given entity path can only ever match one of the two
// (a municipality is either a plain county-having town, a designated-city
// ward, or neither — never both), so trying them in sequence is safe.
export function completeMunicipalityOmission(entityPath: string): MunicipalityCompletion {
  const countyResult = completeCountyTown(entityPath);
  if (countyResult.type !== "none") return countyResult;
  return completeDesignatedCityWard(entityPath);
}
