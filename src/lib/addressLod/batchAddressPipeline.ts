// 移行アダプタ(フェーズ2d)。実体は src/core/batchPipeline.ts。
// 旧シグネチャ(profile / ctx 引数なし)を保つため loa プロファイルを注入。
import { loaProfile, loaContext } from "../../profiles/loa/index.js";
import type { SimplifyLevel } from "../../geo/simplify.js";
import type { DegenerateRingStrategy } from "../../geo/topologySimplify.js";
import * as core from "../../core/batchPipeline.js";

export const CONCURRENCY = loaContext.concurrency;
export const mapWithConcurrency = core.mapWithConcurrency;
export type BatchFeature = core.BatchFeature;
export type ResolveBatchResult = core.ResolveBatchResult;
export type TransformResult = core.TransformResult;

export function resolveBatch(addresses: string[]): Promise<core.ResolveBatchResult> {
  return core.resolveBatch(loaProfile, loaContext, addresses);
}

export function degenerateIslandsUsageError(
  shouldDropSmallIslands: boolean | undefined,
  simplify: SimplifyLevel | undefined,
  degenerateIslands: DegenerateRingStrategy | undefined
): string | undefined {
  return core.degenerateIslandsUsageError(
    loaProfile,
    shouldDropSmallIslands,
    simplify,
    degenerateIslands
  );
}

export function dropSmallIslandsUsageError(
  shouldDropSmallIslands: boolean | undefined,
  features: core.BatchFeature[]
): string | undefined {
  return core.dropSmallIslandsUsageError(loaProfile, shouldDropSmallIslands, features);
}

export function applyDropAndSimplify(
  features: core.BatchFeature[],
  shouldDropSmallIslands: boolean | undefined,
  simplify: SimplifyLevel | undefined,
  degenerateIslands: DegenerateRingStrategy | undefined
): core.TransformResult {
  return core.applyDropAndSimplify(
    loaProfile,
    features,
    shouldDropSmallIslands,
    simplify,
    degenerateIslands
  );
}
