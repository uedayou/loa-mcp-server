import type { DatasetProfile, ProfileContext } from "./profile.js";
import type { EntityFeature, EntityProperties } from "./entityFeature.js";
import { resolveEntityFeature } from "./resolveEntity.js";
import {
  simplifyGeometriesTopologically,
  type DegenerateRingStrategy,
} from "../geo/topologySimplify.js";
import { roundGeometry, roundCoordinate, decimalPlacesFor } from "../geo/coordinatePrecision.js";
import { dropSmallIslands, DEFAULT_MIN_ISLAND_AREA_KM2 } from "../geo/islandFilter.js";
import type { SimplifyLevel } from "../geo/simplify.js";

// 旧 src/lib/addressLod/batchAddressPipeline.ts を profile 駆動に一般化。
// get_address_locations / save_address_locations_to_file 共通の
// 「複数住所を解決して dropSmallIslands・トポロジー simplify・座標丸めを適用する」パイプライン。

export type BatchFeature = Omit<EntityFeature, "properties"> & {
  properties: EntityProperties & { query: string };
};

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ResolveBatchResult {
  features: BatchFeature[];
  unresolved: { address: string; reason: string }[];
  resolvedViaCompletionCount: number;
  centroidCount: number;
}

export async function resolveBatch(
  profile: DatasetProfile,
  ctx: ProfileContext,
  addresses: string[]
): Promise<ResolveBatchResult> {
  const resolved = await mapWithConcurrency(addresses, ctx.concurrency, (a) =>
    resolveEntityFeature(profile, ctx, a)
  );

  const features: BatchFeature[] = [];
  const unresolved: { address: string; reason: string }[] = [];
  let resolvedViaCompletionCount = 0;
  let centroidCount = 0;

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const result = resolved[i];

    if (result.status === "ambiguous") {
      unresolved.push({ address, reason: profile.notes.unresolvedAmbiguous(result.candidates) });
      continue;
    }
    if (result.status === "not_found") {
      unresolved.push({ address, reason: profile.notes.unresolvedNotFound });
      continue;
    }
    if (result.status === "error") {
      unresolved.push({ address, reason: result.message });
      continue;
    }

    if (result.note) resolvedViaCompletionCount++;
    if (result.feature.properties.point_source === "centroid") centroidCount++;

    features.push({
      ...result.feature,
      properties: { ...result.feature.properties, query: address },
    });
  }

  return { features, unresolved, resolvedViaCompletionCount, centroidCount };
}

// degenerateIslands / dropSmallIslands の入力検証(スキーマだけでは表現できない、
// 他パラメータ・features の中身に依存する制約)。文言は profile.notes 由来。

export function degenerateIslandsUsageError(
  profile: DatasetProfile,
  shouldDropSmallIslands: boolean | undefined,
  simplify: SimplifyLevel | undefined,
  degenerateIslands: DegenerateRingStrategy | undefined
): string | undefined {
  if (degenerateIslands && (!shouldDropSmallIslands || !simplify || simplify === "none")) {
    return profile.notes.errDegenerateIslandsUsage;
  }
  return undefined;
}

export function dropSmallIslandsUsageError(
  profile: DatasetProfile,
  shouldDropSmallIslands: boolean | undefined,
  features: BatchFeature[]
): string | undefined {
  if (!shouldDropSmallIslands) return undefined;
  const allow = profile.geometryPolicy?.allowDropSmallIslands;
  const disallowed = allow ? features.filter((f) => !allow(f)) : features;
  if (disallowed.length === 0) return undefined;
  return profile.notes.errDropSmallIslandsUsage(disallowed.map((f) => f.properties.query));
}

export interface TransformResult {
  features: BatchFeature[];
  islandDropNote?: string;
  simplifyNote?: string;
  degenerateOmitNote?: string;
}

// 呼び出し側は必ずまだ変換を適用していない(pristine な)Feature のコピーを渡すこと
// (この関数は geometry を破壊的に書き換えるため)。
export function applyDropAndSimplify(
  profile: DatasetProfile,
  features: BatchFeature[],
  shouldDropSmallIslands: boolean | undefined,
  simplify: SimplifyLevel | undefined,
  degenerateIslands: DegenerateRingStrategy | undefined
): TransformResult {
  let islandDropNote: string | undefined;
  if (shouldDropSmallIslands) {
    let totalDropped = 0;
    let totalDroppedAreaKm2 = 0;
    features.forEach((f) => {
      if (!f.geometry) return;
      const result = dropSmallIslands(f.geometry);
      f.geometry = result.geometry;
      totalDropped += result.droppedCount;
      totalDroppedAreaKm2 += result.droppedAreaKm2;
    });
    islandDropNote = profile.notes.islandsDropped(
      totalDropped,
      totalDroppedAreaKm2,
      DEFAULT_MIN_ISLAND_AREA_KM2
    );
  }

  let simplifyNote: string | undefined;
  let degenerateOmitNote: string | undefined;
  if (simplify && simplify !== "none" && features.length > 0) {
    const { geometries, originalPoints, simplifiedPoints, omittedPartCount } =
      simplifyGeometriesTopologically(
        features.map((f) => f.geometry),
        simplify,
        degenerateIslands
      );
    features.forEach((f, i) => {
      f.geometry = geometries[i];
    });
    if (originalPoints > 0) {
      simplifyNote = profile.notes.simplifyAppliedTopology(
        simplify,
        originalPoints,
        simplifiedPoints
      );
    }
    if (degenerateIslands === "omit") {
      degenerateOmitNote = profile.notes.degenerateIslandsOmitted(omittedPartCount, simplify);
    }
  }

  const decimalPlaces = decimalPlacesFor(simplify);
  features.forEach((f) => {
    f.geometry = f.geometry ? roundGeometry(f.geometry, decimalPlaces) : null;
    f.properties.lat = roundCoordinate(f.properties.lat, decimalPlaces);
    f.properties.long = roundCoordinate(f.properties.long, decimalPlaces);
  });

  return { features, islandDropNote, simplifyNote, degenerateOmitNote };
}
