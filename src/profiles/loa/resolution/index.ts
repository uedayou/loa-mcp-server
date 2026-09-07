import type { InputNormalizer, ResolutionFallback } from "../../../core/resolutionTypes.js";
import { normalizeAddressNumerals } from "./numeralNormalization.js";
import { completeMunicipalityOmission } from "./municipalityCompletion.js";
import { generateVariantCandidates } from "./variantCharacters.js";

// loa の住所解決カスケードを core の汎用インターフェースに載せたもの
// (design §3.5)。挙動は現行 src/lib/addressLod/resolveAddress.ts と等価:
//   直接取得 → 郡/政令市名の省略補完 → 異体字(ケ/ヶ/ヵ)リトライ。

// 常時適用: 全角/漢数字/ハイフン区切りの数字表記を半角に正規化する
// (曖昧性のない純粋な文字列変換)。
export const loaInputNormalizers: InputNormalizer[] = [normalizeAddressNumerals];

// 404 後のフォールバック(順序が意味を持つ)。
export const loaFallbacks: ResolutionFallback[] = [
  {
    name: "municipality-omission",
    run(path, originalInput) {
      const completion = completeMunicipalityOmission(path);
      if (completion.type === "corrected") {
        return {
          type: "candidates",
          paths: [completion.entityPath],
          note: (chosen) =>
            `"${originalInput}" は表記が省略されていたため「${chosen}」として解決した。`,
        };
      }
      if (completion.type === "ambiguous") {
        return {
          type: "ambiguous",
          labels: completion.candidates.map((c) => c.label),
        };
      }
      return { type: "none" };
    },
  },
  {
    name: "variant-characters",
    run(path, originalInput) {
      const candidates = generateVariantCandidates(path);
      if (candidates.length === 0) return { type: "none" };
      return {
        type: "candidates",
        paths: candidates,
        note: (chosen) =>
          `"${originalInput}" は異体字の表記ゆれがあったため「${chosen}」として解決した。`,
      };
    },
  },
];
