import { stringConcatIdentifier } from "../../core/identifierStrategies.js";

// 住所LOD の URI 設計: 住所文字列(漢字表記)をベースURLに生の Unicode で連結する。
// - IRIREF には生 Unicode を埋める(実データが生 Unicode の IRI を使うため、
//   percent-encode すると SPARQL が0件になる。design-address-mcp.md §6 の教訓)。
// - .ttl 取得 URL ではパスを encodeURIComponent する。
// - フォーマットは拡張子方式(`{住所}.ttl` / `{住所}.geojson`)。
//
// 数字表記(全角/漢数字/ハイフン)の正規化は identifier ではなく
// resolution.inputNormalizers 側で行う(責務分離、design §3.4)。
export const loaIdentifier = stringConcatIdentifier({
  knownExtensions: [".geojson", ".jsonld", ".json", ".ttl", ".xml"],
  rawUnicodeIri: true,
  fetchUrlEncoding: "encodeURIComponent",
  dereferenceMode: "extension",
  allowPathSeparators: true,
});
