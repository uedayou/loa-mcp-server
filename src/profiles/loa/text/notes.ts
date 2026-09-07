import type { ProfileNotes } from "../../../core/profile.js";

// 共有機構(core/featureNotes.ts / core/batchPipeline.ts / core/resolveEntity.ts)が
// 出す横断的な注記の文言(design §0 モデルB-mid)。
// 現行の src/lib/addressLod/{featureNotes,batchAddressPipeline}.ts の文字列を
// verbatim に移植している。1文字でも変えると注記を検証する既存テストが落ちる。
export const LOA_NOTES: ProfileNotes = {
  centroidPoint:
    "代表点(lat/long)は住所LODに存在しないため、ポリゴンの重心から算出した近似値。",

  renderingHint:
    "geometryは標準的なGeoJSON。Leafletの L.geoJSON()、MapLibre GL JS、deck.gl等のGeoJSON対応の地図ライブラリにそのまま渡して表示できる。座標変換やSVGでの手動描画は不要。",

  simplifyApplied: (level, before, after) =>
    `simplify:'${level}' で座標点数を ${before} → ${after} に間引いた(形状は近似)。`,

  simplifyAppliedTopology: (level, before, after) =>
    `simplify:'${level}' で座標点数を合計 ${before} → ${after} に間引いた(形状は近似)。` +
    "隣接する地域間の境界線は共有された状態のまま簡略化しているため、境界のズレ(隙間)は発生しない。",

  islandsDropped: (count, lostAreaKm2, thresholdKm2) =>
    `dropSmallIslands:true により、実面積約${thresholdKm2}km^2未満の離島${count}個(失われた面積は合計約` +
    `${lostAreaKm2.toFixed(2)}km^2)が結果から除外されており、地図上には表示されない。正確な形状が必要な場合はfalseで再取得すること。`,

  degenerateIslandsOmitted: (count, level) =>
    `degenerateIslands:"omit" により、simplify:'${level}' の簡略化で形状が壊れた離島を追加で${count}個除外しており、` +
    "これらも地図上には表示されない(dropSmallIslandsによる除外とは別)。正確な形状を保ちたい場合は degenerateIslands:\"keepOriginal\"(既定)を使うこと。",

  unresolvedNotFound: "完全一致する住所が見つからなかった(表記揺れの可能性)",

  unresolvedAmbiguous: (candidates) =>
    `同名の地名が複数存在するため一意に決められない: ${candidates.join("、")}`,

  errDegenerateIslandsUsage:
    "degenerateIslands は dropSmallIslands:true かつ simplify が'none'以外である場合のみ指定できる" +
    "(simplifyによる簡略化が行われないと、退化した離島という概念自体が発生しないため)。",

  errDropSmallIslandsUsage: (nonPrefectureQueries) =>
    "dropSmallIslands:true は addresses の全要素が都道府県そのものである場合のみ指定できるが、" +
    `都道府県ではない要素が含まれている: ${nonPrefectureQueries.map((q) => `"${q}"`).join("、")}。`,
};
