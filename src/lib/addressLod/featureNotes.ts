// 移行アダプタ(フェーズ2d)。実体は src/core/featureNotes.ts。
// 旧シグネチャ(profile 引数なし)を保つため loaProfile を注入して呼ぶ。
import { loaProfile } from "../../profiles/loa/index.js";
import type { EntityFeature } from "../../core/entityFeature.js";
import type { SimplifyLevel } from "../../geo/simplify.js";
import * as core from "../../core/featureNotes.js";

export function applySimplify(feature: EntityFeature, level: SimplifyLevel | undefined) {
  return core.applySimplify(loaProfile, feature, level);
}

export function pointSourceNote(feature: EntityFeature): string | undefined {
  return core.pointSourceNote(loaProfile, feature);
}

export function renderingHintNote(feature: EntityFeature): string | undefined {
  return core.renderingHintNote(loaProfile, feature);
}

export function roundFeatureCoordinates(
  feature: EntityFeature,
  level: SimplifyLevel | undefined
): EntityFeature {
  return core.roundFeatureCoordinates(feature, level);
}

export function finalizeFeature(feature: EntityFeature, level: SimplifyLevel | undefined) {
  return core.finalizeFeature(loaProfile, feature, level);
}
