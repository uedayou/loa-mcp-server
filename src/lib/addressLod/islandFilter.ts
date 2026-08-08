import type { GeoJsonGeometry } from "./wkt.js";

// 都道府県レベルのMultiPolygonから、実面積が小さい離島(岩礁・洲を含む)を
// 丸ごと除外するフィルタ。47都道府県を結合した日本地図をGeoJSONとして
// 生成する用途向け(ユーザーとの合意、2026-08-07)。詳細な実測根拠は
// docs/design-island-filter.md 参照。
//
// **背景**: 47都道府県をまとめてトポロジー簡略化(topologySimplify.ts)しても、
// 全国の座標点数は数十万点規模から頭打ちになる。実測したところ、原因は
// 「間引きが甘い」ことではなく、全国に121,834パーツ(離島単位)存在する
// うち121,000件超が退化(縮退)判定でフル精度のまま残ってしまうこと、かつ
// そのフル精度自体が既に「4点(3頂点+閉じる点)」という最小構成であること
// だった(=これ以上点数を間引く余地がない)。したがって点数を間引く方向の
// アプローチでは解決できず、小さい離島そのものを結果から除外する必要が
// あると判断した。実測では面積0.01km^2(≒100m四方)未満のパーツを除外
// しても、失われる面積は日本の国土面積のわずか0.0065%だった。

// 緯度によって経度1度あたりの実距離が大きく変わる(沖縄と北海道で経度の
// 縮尺が約20%異なる)ため、リングごとに実際の緯度範囲からcos補正する。
function ringAreaKm2(ring: number[][]): number {
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

// 実データ(47都道府県)で効果測定して選定: 0.01km^2未満を除外すると、
// パーツ数は121,834→2,167(98.2%削減)まで減る一方、失われる面積は
// 日本の国土面積のわずか0.0065%(medium/highと組み合わせるとさらに大きく
// 削減できる)。詳細は docs/design-island-filter.md 参照。
export const DEFAULT_MIN_ISLAND_AREA_KM2 = 0.01;

export interface IslandFilterResult {
  geometry: GeoJsonGeometry;
  droppedCount: number;
  droppedAreaKm2: number;
}

// Polygon(単一パーツ)には除外できる対象がないため素通しする。住所LODの
// 実データにポリゴンの穴(内輪)は存在しないため(docs/design-ttl-conversion.md
// 参照)、各パーツは外輪(polygon[0])だけを見れば面積判定として十分。
export function dropSmallIslands(
  geometry: GeoJsonGeometry,
  minAreaKm2: number = DEFAULT_MIN_ISLAND_AREA_KM2
): IslandFilterResult {
  if (geometry.type !== "MultiPolygon") {
    return { geometry, droppedCount: 0, droppedAreaKm2: 0 };
  }

  const parts = geometry.coordinates.map((polygon) => ({
    polygon,
    area: ringAreaKm2(polygon[0]),
  }));

  let kept = parts.filter((p) => p.area >= minAreaKm2);
  // 安全策: 理論上は本土/最大パーツが必ずしきい値を超えるため起きないが、
  // 万一すべてのパーツが除外された場合は最大パーツだけは必ず残す。
  if (kept.length === 0) {
    kept = [parts.reduce((a, b) => (b.area > a.area ? b : a))];
  }
  const keptSet = new Set(kept);
  const dropped = parts.filter((p) => !keptSet.has(p));

  const resultGeometry: GeoJsonGeometry =
    kept.length === 1
      ? { type: "Polygon", coordinates: kept[0].polygon }
      : { type: "MultiPolygon", coordinates: kept.map((p) => p.polygon) };

  return {
    geometry: resultGeometry,
    droppedCount: dropped.length,
    droppedAreaKm2: dropped.reduce((sum, p) => sum + p.area, 0),
  };
}
