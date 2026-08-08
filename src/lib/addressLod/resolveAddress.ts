import { fetchAddressLocation, type AddressFeature } from "./ttl.js";
import { normalizeToEntityPath } from "./uri.js";
import { completeMunicipalityOmission } from "./municipalityCompletion.js";
import { generateVariantCandidates } from "./variantCharacters.js";
import { AddressNotFoundError, AddressLodError } from "./errors.js";

export type ResolvedAddress =
  | { status: "resolved"; feature: AddressFeature; note?: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

// get_address_location / get_address_locations共通の住所解決カスケード:
// 直接取得 → 404なら郡名/政令市名の省略補完を試行 → それでもダメなら異体字
// (ケ/ヶ/ヵ)のリトライ。単一Tool向けに書かれていた元のロジックをToolから
// 切り出したもの(元は src/tools/getAddressLocation.ts に直接書かれていた)。
export async function resolveAddressFeature(address: string): Promise<ResolvedAddress> {
  try {
    const feature = await fetchAddressLocation(address);
    return { status: "resolved", feature };
  } catch (error) {
    if (!(error instanceof AddressNotFoundError)) {
      const message =
        error instanceof AddressLodError
          ? error.message
          : `Unexpected error: ${(error as Error).message}`;
      return { status: "error", message };
    }

    // 「〇〇郡△△町」の郡名、または政令指定都市の市名が省略されている
    // 可能性がある。住所LOD側のSPARQLグラフには省略形が載っていないため、
    // 静的な補完データ(countyTownIndex/designatedCityWardIndex)を使って
    // 一度だけ正式名で再試行する。
    const entityPath = normalizeToEntityPath(address);
    const completion = completeMunicipalityOmission(entityPath);

    if (completion.type === "corrected") {
      try {
        const feature = await fetchAddressLocation(completion.entityPath);
        return {
          status: "resolved",
          feature,
          note: `"${address}" は表記が省略されていたため「${completion.entityPath}」として解決した。`,
        };
      } catch {
        // 補完後も見つからなければ以下のフォールバックへ。
      }
    }

    if (completion.type === "ambiguous") {
      return { status: "ambiguous", candidates: completion.candidates.map((c) => c.label) };
    }

    // 「ケ/ヶ/ヵ」等の異体字表記ゆれの可能性がある。既知の候補を順に試す。
    for (const candidate of generateVariantCandidates(entityPath)) {
      try {
        const feature = await fetchAddressLocation(candidate);
        return {
          status: "resolved",
          feature,
          note: `"${address}" は異体字の表記ゆれがあったため「${candidate}」として解決した。`,
        };
      } catch {
        // 次の候補を試す。
      }
    }

    return { status: "not_found" };
  }
}
