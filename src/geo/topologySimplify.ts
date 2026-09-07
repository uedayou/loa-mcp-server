import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { feature } from "topojson-client";
import type { Topology, Objects, Polygon, MultiPolygon } from "topojson-specification";
import type { GeoJsonGeometry } from "./wkt.js";
import { countGeometryPoints, type SimplifyLevel } from "./simplify.js";

// topojson-server/-simplify/-clientのDefinitelyTyped型定義は、Propertiesの
// ジェネリクスがパッケージ間で微妙にかみ合わない(例: topologyの戻り値は
// `GeoJsonProperties`(null許容)だが、presimplifyの既定は`{}`)。このモジュール
// は座標(arcs)だけを扱いプロパティは一切使わないため、`{}`に固定して1箇所
// でキャストし、以降はその型で統一する。
type Topo = Topology<Objects<Record<string, never>>>;

// get_address_locationsのように複数のポリゴンをまとめて扱うとき、各ポリゴンを
// 独立にRamer-Douglas-Peucker(simplify.ts)で間引くと、隣接する地域同士が共有
// しているはずの境界線が別々に間引かれてズレ、地図表示したときに隙間や
// 重なりが生じる(実際にClaude Desktopで千代田区の全町を表示した際に報告
// された)。この関数はTopoJSON(topojson-server/-simplify/-client)を使い、
// 「複数のポリゴンをまず1つのトポロジー(共有境界線=arcの集合)として構築し、
// 各arcを1回だけ簡略化してから、元のポリゴンへ再構成する」ことで、共有
// 境界線が常に完全に一致した状態を保証する(隙間が原理的に発生しない)。
//
// トレランスの単位はRDP(simplify.ts)とは異なる(Visvalingam-Whyattの
// 「実効面積」に基づく分位点)ため、実データ(東京都千代田区の全59町、
// 2,843点)で実際の削減率を測定して選んだ。詳細は
// docs/design-topology-simplification.md 参照。
const QUANTILE_P: Record<Exclude<SimplifyLevel, "none">, number> = {
  low: 0.12, // 実測: 76%削減
  medium: 0.03, // 実測: 84%削減
  high: 0.008, // 実測: 86%削減
};

export interface TopologySimplifyResult {
  geometries: (GeoJsonGeometry | null)[];
  originalPoints: number;
  simplifiedPoints: number;
  omittedPartCount: number;
}

// 退化したリング/パーツをどう扱うか。"keepOriginal"(既定)は簡略化前の
// フル精度に戻す(全レベルの通常経路)。"omit"は都道府県レベル限定
// (dropSmallIslandsと併用、get_address_locations参照)で、退化したパーツを
// 結果から丸ごと除外することでさらに軽量化する代わりに、その離島は地図上に
// 一切表示されなくなる(呼び出し側が必ずユーザに注記すること)。
export type DegenerateRingStrategy = "keepOriginal" | "omit";

export function simplifyGeometriesTopologically(
  geometries: (GeoJsonGeometry | null)[],
  level: Exclude<SimplifyLevel, "none">,
  degenerateRingStrategy: DegenerateRingStrategy = "keepOriginal"
): TopologySimplifyResult {
  const originalPoints = countAll(geometries);

  // Point、またはgeometryなしの要素はトポロジーの対象外(そのまま素通し)。
  const objects: Record<string, GeoJsonGeometry> = {};
  for (let i = 0; i < geometries.length; i++) {
    const g = geometries[i];
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) {
      objects[i] = g;
    }
  }

  if (Object.keys(objects).length === 0) {
    return { geometries, originalPoints, simplifiedPoints: originalPoints, omittedPartCount: 0 };
  }

  const topo = topology(objects) as Topo;
  const pre = presimplify(topo);
  const minWeight = quantile(pre, QUANTILE_P[level]);
  const simplifiedTopo = simplify(pre, minWeight);

  const result = [...geometries];
  let omittedPartCount = 0;
  for (const key of Object.keys(objects)) {
    const i = Number(key);
    // 実行時にはPolygon/MultiPolygonしか`objects`へ入れていないため、常に
    // Feature(FeatureCollectionではない)が返る。オーバーロード解決が
    // union引数をうまく絞り込めないため、戻り値の形を直接キャストする。
    const object = simplifiedTopo.objects[key] as Polygon | MultiPolygon;
    const geoFeature = feature(simplifiedTopo, object) as { geometry: GeoJsonGeometry };
    const simplifiedGeometry = geoFeature.geometry;
    // トポロジー全体で1つの閾値(実効面積)を使うため、他の(より大きい)
    // ポリゴンに対しては妥当な閾値でも、もともと小さい/単純なポリゴンでは
    // 全ての点がその閾値を下回り、境界全体が1点に潰れてしまうことがある
    // (実データで確認済み: 東京都千代田区「神田平河町」がsimplify:"high"で
    // 4点すべて同一座標に潰れた)。RDPベースのsimplify.tsが持つ
    // 「簡略化結果が4点未満ならリングを簡略化前に戻す」ガードと同じ考え方で、
    // 潰れたリングだけ簡略化前の形状にフォールバックする。
    //
    // **リング単位**で行う(Feature全体を丸ごと戻すのではない)ことが重要:
    // 港区・品川区・江東区・大田区のような臨海部の区は、埋立地・小島を
    // 多数含むMultiPolygon(実データ: 江東区は75パーツ、うち35パーツが
    // 最小サイズの5点)で、そのうちの小さな島1つが潰れただけでもFeature
    // 全体を元に戻すと、区の本体(他の区と境界を共有している大きな部分)
    // まで簡略化されなくなり、隣接する区との間で境界の精度が食い違って
    // 隙間が生じてしまう(実機で発見・修正、2026-08-06)。リング単位で
    // 戻せば、影響は潰れた島だけに限定され、本体の共有境界は保たれる。
    if (degenerateRingStrategy === "omit") {
      const { geometry, omittedCount } = omitDegenerateParts(simplifiedGeometry, objects[key]);
      result[i] = geometry;
      omittedPartCount += omittedCount;
    } else {
      result[i] = fixDegenerateRings(simplifiedGeometry, objects[key]);
    }
  }

  return { geometries: result, originalPoints, simplifiedPoints: countAll(result), omittedPartCount };
}

function countAll(geometries: (GeoJsonGeometry | null)[]): number {
  return geometries.reduce((sum, g) => sum + (g ? countGeometryPoints(g) : 0), 0);
}

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

// リングが有効な多角形として成立しなくなっていないか(点数不足・面積ゼロ・
// 実質的に3点未満にまで潰れている)を判定する。
function isDegenerateRing(ring: number[][]): boolean {
  if (ring.length < 4) return true;
  const uniquePoints = new Set(ring.slice(0, -1).map((p) => p.join(",")));
  if (uniquePoints.size < 3) return true;
  return ringArea(ring) === 0;
}

// 簡略化結果の各リングを、対応する元のリング(同じPolygon/リング位置)と
// 突き合わせ、退化しているリングだけを元の形状に差し替える。topojson-simplify
// は各arcの点数を減らすだけでPolygon/リングの数や並び順を変えないため、
// simplified側とoriginal側は常に同じ形状構造(Polygon数・リング数)を持つ
// という前提に立っている。
function fixDegenerateRings(
  simplified: GeoJsonGeometry,
  original: GeoJsonGeometry
): GeoJsonGeometry {
  if (simplified.type === "Polygon" && original.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: simplified.coordinates.map((ring, i) =>
        isDegenerateRing(ring) ? original.coordinates[i] : ring
      ),
    };
  }
  if (simplified.type === "MultiPolygon" && original.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: simplified.coordinates.map((polygon, pi) =>
        polygon.map((ring, ri) => (isDegenerateRing(ring) ? original.coordinates[pi][ri] : ring))
      ),
    };
  }
  return simplified;
}

// "omit"戦略: 外輪が退化したパーツ(=islandFilter.tsのdropSmallIslandsと同じ
// 「パーツ=離島単位」の考え方)を丸ごと除外する。fixDegenerateRings と違い
// リング単位ではなくパーツ単位で判定する(内輪の退化は住所LODの実データに
// ほぼ存在しないため考慮しない、docs/design-ttl-conversion.md参照)。
// dropSmallIslands(都道府県レベル限定)と組み合わせて使う前提のため、
// 対象は既に大きな本土パーツを含むことが実データで確認済みだが、万一
// すべてのパーツが退化した場合は元データの最大パーツだけを残す安全策を持つ。
function omitDegenerateParts(
  simplified: GeoJsonGeometry,
  original: GeoJsonGeometry
): { geometry: GeoJsonGeometry; omittedCount: number } {
  if (simplified.type === "Polygon") {
    if (!isDegenerateRing(simplified.coordinates[0])) {
      return { geometry: simplified, omittedCount: 0 };
    }
    // 単一パーツしかないFeatureがまるごと退化した場合の安全策。
    return { geometry: original, omittedCount: 0 };
  }
  if (simplified.type === "MultiPolygon" && original.type === "MultiPolygon") {
    const keptParts = simplified.coordinates.filter((part) => !isDegenerateRing(part[0]));
    const omittedCount = simplified.coordinates.length - keptParts.length;
    if (keptParts.length === 0) {
      // 安全策: 理論上は本土/最大パーツが必ず生き残るため起きないが、万一
      // すべて退化した場合は元データの最大パーツだけを残す。
      let largest = original.coordinates[0];
      let largestArea = ringArea(largest[0]);
      for (const part of original.coordinates.slice(1)) {
        const area = ringArea(part[0]);
        if (area > largestArea) {
          largest = part;
          largestArea = area;
        }
      }
      return { geometry: { type: "Polygon", coordinates: largest }, omittedCount: simplified.coordinates.length - 1 };
    }
    const geometry: GeoJsonGeometry =
      keptParts.length === 1
        ? { type: "Polygon", coordinates: keptParts[0] }
        : { type: "MultiPolygon", coordinates: keptParts };
    return { geometry, omittedCount };
  }
  return { geometry: simplified, omittedCount: 0 };
}
