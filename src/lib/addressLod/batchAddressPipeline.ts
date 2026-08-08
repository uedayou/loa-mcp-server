import { resolveAddressFeature } from "./resolveAddress.js";
import { simplifyGeometriesTopologically, type DegenerateRingStrategy } from "./topologySimplify.js";
import { roundGeometry, roundCoordinate, decimalPlacesFor } from "./coordinatePrecision.js";
import { dropSmallIslands, DEFAULT_MIN_ISLAND_AREA_KM2 } from "./islandFilter.js";
import { isPrefectureName } from "./prefectures.js";
import type { AddressFeature } from "./ttl.js";
import type { SimplifyLevel } from "./simplify.js";

// get_address_locations / save_address_locations_to_file 共通の「複数住所を
// 解決してdropSmallIslands・トポロジーsimplify・座標丸めを適用する」パイプライン。

export const CONCURRENCY = 5; // 住所LOD側への配慮のため、全件同時に投げない。

export type BatchFeature = Omit<AddressFeature, "properties"> & {
  properties: AddressFeature["properties"] & { query: string };
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

// addressesを解決し、BatchFeature[](properties.queryに元の入力住所を保持)に
// まとめる。一部が解決できなくても例外は投げず、unresolvedに振り分ける。
export async function resolveBatch(addresses: string[]): Promise<ResolveBatchResult> {
  const resolved = await mapWithConcurrency(addresses, CONCURRENCY, resolveAddressFeature);

  const features: BatchFeature[] = [];
  const unresolved: { address: string; reason: string }[] = [];
  let resolvedViaCompletionCount = 0;
  let centroidCount = 0;

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const result = resolved[i];

    if (result.status === "ambiguous") {
      unresolved.push({
        address,
        reason: `同名の地名が複数存在するため一意に決められない: ${result.candidates.join("、")}`,
      });
      continue;
    }
    if (result.status === "not_found") {
      unresolved.push({ address, reason: "完全一致する住所が見つからなかった(表記揺れの可能性)" });
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

// degenerateIslands / dropSmallIslands はToolの入力検証(スキーマだけでは
// 表現できない、他パラメータ・featuresの中身に依存する制約)なので、
// エラーメッセージ文言ごと共通化し、両Toolで完全に同じ挙動にする。

export function degenerateIslandsUsageError(
  shouldDropSmallIslands: boolean | undefined,
  simplify: SimplifyLevel | undefined,
  degenerateIslands: DegenerateRingStrategy | undefined
): string | undefined {
  if (degenerateIslands && (!shouldDropSmallIslands || !simplify || simplify === "none")) {
    return (
      "degenerateIslands は dropSmallIslands:true かつ simplify が'none'以外である場合のみ指定できる" +
      "(simplifyによる簡略化が行われないと、退化した離島という概念自体が発生しないため)。"
    );
  }
  return undefined;
}

export function dropSmallIslandsUsageError(
  shouldDropSmallIslands: boolean | undefined,
  features: BatchFeature[]
): string | undefined {
  if (!shouldDropSmallIslands) return undefined;
  const nonPrefectures = features.filter((f) => !isPrefectureName(f.properties.name));
  if (nonPrefectures.length === 0) return undefined;
  return (
    "dropSmallIslands:true は addresses の全要素が都道府県そのものである場合のみ指定できるが、" +
    `都道府県ではない要素が含まれている: ${nonPrefectures.map((f) => `"${f.properties.query}"`).join("、")}。`
  );
}

export interface TransformResult {
  features: BatchFeature[];
  islandDropNote?: string;
  simplifyNote?: string;
  degenerateOmitNote?: string;
}

// dropSmallIslands→トポロジーsimplify→座標丸め、の変換パイプライン本体。
// 呼び出し側は必ずまだ変換を適用していない(pristineな)Featureのコピーを
// 渡すこと(この関数はgeometryを破壊的に書き換えるため、呼び出し元で
// 別のパラメータで再試行する可能性がある場合はstructuredCloneしたコピーを使う)。
export function applyDropAndSimplify(
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
    islandDropNote =
      `dropSmallIslands:true により、実面積約${DEFAULT_MIN_ISLAND_AREA_KM2}km^2未満の離島${totalDropped}個(失われた面積は合計約` +
      `${totalDroppedAreaKm2.toFixed(2)}km^2)が結果から除外されており、地図上には表示されない。正確な形状が必要な場合はfalseで再取得すること。`;
  }

  let simplifyNote: string | undefined;
  let degenerateOmitNote: string | undefined;
  if (simplify && simplify !== "none" && features.length > 0) {
    const { geometries, originalPoints, simplifiedPoints, omittedPartCount } = simplifyGeometriesTopologically(
      features.map((f) => f.geometry),
      simplify,
      degenerateIslands
    );
    features.forEach((f, i) => {
      f.geometry = geometries[i];
    });
    if (originalPoints > 0) {
      simplifyNote =
        `simplify:'${simplify}' で座標点数を合計 ${originalPoints} → ${simplifiedPoints} に間引いた(形状は近似)。` +
        "隣接する地域間の境界線は共有された状態のまま簡略化しているため、境界のズレ(隙間)は発生しない。";
    }
    if (degenerateIslands === "omit") {
      degenerateOmitNote =
        `degenerateIslands:"omit" により、simplify:'${simplify}' の簡略化で形状が壊れた離島を追加で${omittedPartCount}個除外しており、` +
        "これらも地図上には表示されない(dropSmallIslandsによる除外とは別)。正確な形状を保ちたい場合は degenerateIslands:\"keepOriginal\"(既定)を使うこと。";
    }
  }

  // 座標をJSON化直前の第6位(約11cm精度)に丸める(simplify:"high"のときだけ
  // 第5位、decimalPlacesFor参照)。simplifyはこれより前に元の精度のまま
  // 行われている。get_address_locationのfinalizeFeature()と同じ丸め処理
  // (coordinatePrecision.ts)。
  const decimalPlaces = decimalPlacesFor(simplify);
  features.forEach((f) => {
    f.geometry = f.geometry ? roundGeometry(f.geometry, decimalPlaces) : null;
    f.properties.lat = roundCoordinate(f.properties.lat, decimalPlaces);
    f.properties.long = roundCoordinate(f.properties.long, decimalPlaces);
  });

  return { features, islandDropNote, simplifyNote, degenerateOmitNote };
}
