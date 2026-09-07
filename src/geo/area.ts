import type { GeoJsonGeometry } from "./wkt.js";

// 緯度によって経度1度あたりの実距離が大きく変わる(沖縄と北海道で経度の
// 縮尺が約20%異なる)ため、リングごとに実際の緯度範囲からcos補正する。
// islandFilter.ts(離島判定用の面積)と共通のため、ここに集約している。
export function ringAreaKm2(ring: number[][]): number {
  let latSum = 0;
  for (const [, lat] of ring) latSum += lat;
  const lat0 = latSum / ring.length;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = kmPerDegLat * Math.cos((lat0 * Math.PI) / 180);

  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2) * kmPerDegLon * kmPerDegLat;
}

// Polygon/MultiPolygonの実面積(概算、km^2)。dropSmallIslands(離島除外)や
// centroid(最大パーツのみ)と異なり、面積は「そのエンティティの正確な広さ」
// を答える用途のため、MultiPolygonの全パーツ(離島も含む)を合計する。
// Pointは面積を持たないため0を返す(呼び出し側で判定すること。
// get_address_areasは番地レベル(Point)を面積なしとして別途報告する)。
// 住所LODの実データにポリゴンの穴(内輪)は存在しないため
// (docs/design-ttl-conversion.md参照)、各パーツは外輪(polygon[0])
// だけを見れば面積計算として十分。
//
// **精度についての注記**: この計算はGeoJSON座標(緯度経度)に対する平面近似
// (shoelace公式+緯度によるcos補正)であり、国土地理院が公表する公式統計
// (測地系での厳密な計算、干潟・係争地の扱い等の実務ルールを含む)とは
// 一致しない。あくまで住所LODのポリゴンから機械的に算出した近似値。
export function calculateAreaKm2(geometry: GeoJsonGeometry): number {
  if (geometry.type === "Polygon") {
    return ringAreaKm2(geometry.coordinates[0]);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, polygon) => sum + ringAreaKm2(polygon[0]), 0);
  }
  return 0;
}
