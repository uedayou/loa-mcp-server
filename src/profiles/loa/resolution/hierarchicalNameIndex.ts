import { findPrefecturePrefix } from "./prefectures.js";

// Shared shape for both completion tables (countyTownIndex.ts and
// designatedCityWardIndex.ts): a bare name (town without its county, or ward
// without its designated city) maps to candidates carrying the full segment
// that should replace it in the entity path.
export interface HierarchicalCandidate {
  prefecture: string;
  municipality: string; // the full replacement segment, e.g. "西多摩郡瑞穂町" or "横浜市南区"
  uri: string;
  label: string;
}

export type HierarchicalCompletion<C extends HierarchicalCandidate> =
  | { type: "corrected"; entityPath: string; candidate: C }
  | { type: "ambiguous"; candidates: C[] }
  | { type: "none" };

export function findCandidates<C extends HierarchicalCandidate>(
  index: Record<string, C[]>,
  bareName: string,
  prefecture?: string
): C[] {
  const candidates = index[bareName] ?? [];
  return prefecture ? candidates.filter((c) => c.prefecture === prefecture) : candidates;
}

// Attempts to repair an entity path that omits an intermediate level (a
// county, or a designated city's own name) by finding the longest known bare
// name that prefixes what follows the prefecture, then substituting in the
// full form. Shared by countyTownIndex.ts and designatedCityWardIndex.ts —
// see either for the concrete motivation and data source.
export function completeFromIndex<C extends HierarchicalCandidate>(
  entityPath: string,
  index: Record<string, C[]>
): HierarchicalCompletion<C> {
  const prefecture = findPrefecturePrefix(entityPath);
  if (!prefecture) return { type: "none" };

  const rest = entityPath.slice(prefecture.length);
  if (!rest) return { type: "none" };

  // Prefer the longest matching bare name, in case one name is itself a
  // prefix of another (e.g. "山田町" vs. "山田町西").
  let bestKey: string | null = null;
  for (const key of Object.keys(index)) {
    if (rest.startsWith(key) && (bestKey === null || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  if (!bestKey) return { type: "none" };

  const candidates = findCandidates(index, bestKey, prefecture);
  if (candidates.length === 0) return { type: "none" };
  if (candidates.length > 1) return { type: "ambiguous", candidates };

  const candidate = candidates[0];
  const suffix = rest.slice(bestKey.length); // e.g. "高根" in "瑞穂町高根"
  return {
    type: "corrected",
    entityPath: `${prefecture}${candidate.municipality}${suffix}`,
    candidate,
  };
}
