import type { GeoJsonGeometry } from "./wkt.js";

// 住所LODの町丁目データには、丁目の境界をあえてunionせず複数のPolygonとして
// 保持しているMultiPolygonが実在する(実機確認済み2026-08-06: 東京都新宿区
// 歌舞伎町(丁目なし)の geosp:asWKT は74点/84点の2パーツのMULTIPOLYGONで、
// 境界線上に32個の完全一致する座標点がある=1丁目/2丁目の境界を意図的に
// 保持したもの)。このMCPサーバーの用途では丁目内部の境界を保持する必要は
// ないため、境界を共有する部分は自動的にdissolve(union)する。
//
// 境界を共有しない部分(例: 東京都の伊豆・小笠原諸島のような、独立した離島)
// には一切手を加えない — これは意図的な設計で、事前に「共有辺があるか」を
// 安価にチェックし、なければ(コストの高い)union演算そのものをスキップする。
// これにより、都道府県レベルの数千パーツのMultiPolygon(実データ: 東京都は
// 6,721パーツ)に対して不要な計算を避けられる。
//
// **実装方式についての重要な注記(2026-08-06、`polygon-clipping`から書き換え)**:
// 当初は一般的なポリゴンunionライブラリ`polygon-clipping`(Martinez-Rueda
// アルゴリズム)を使っていたが、実機検証で「dissolve対象の町自身の内部の
// 継ぎ目とは無関係な、外側の境界線の座標まで(値としては近いが厳密には
// 異なる値に)書き換えてしまい、隣接する別の町との完全一致による境界共有が
// 静かに壊れる」という重大な副作用が判明した(千代田区の実データで、
// dissolve対象になる29町のうち隣接ペア63組でこれが発生し、地図上に隙間が
// 生じた)。
//
// 本来この関数が扱う対象は「完全に一致する(向きが逆の)座標の辺を共有して
// いる」という強い前提(`hasSharedEdge()`で事前確認済み)を満たすケースに
// 限られており、一般のポリゴンunion(自己交差や部分重なりを含む任意の
// ポリゴンの結合)ほど難しい問題ではない。そこで、共有辺を検出して
// キャンセルし、残った辺を**元の座標オブジェクトそのものを使って**繋ぎ直す
// という自前の実装に切り替えた。新しい座標値を一切計算しない(既存の点を
// 選び直して並べるだけ)ため、内部の継ぎ目以外の頂点は入力データと常に
// bit-exactに一致する。

export function dissolveMultiPolygon(geometry: GeoJsonGeometry): GeoJsonGeometry {
  if (geometry.type !== "MultiPolygon" || geometry.coordinates.length < 2) {
    return geometry;
  }
  // 住所LODの実データにポリゴンの穴(内輪)は存在しないため
  // (docs/design-ttl-conversion.md 参照)、各パーツの外輪(最初のリング)
  // だけを見れば十分という前提に立っている。
  const rings = geometry.coordinates.map((polygon) => polygon[0]);

  if (!hasSharedEdge(rings)) {
    return geometry;
  }

  const resultRings = dissolveRings(rings);

  return resultRings.length === 1
    ? { type: "Polygon", coordinates: [resultRings[0]] }
    : { type: "MultiPolygon", coordinates: resultRings.map((ring) => [ring]) };
}

// 2つのリングが同一座標の辺を(向きだけ逆に)共有していないかを調べる、
// O(総点数)の軽量な事前チェック。厳密な座標一致のみを見る(浮動小数点誤差
// の吸収は行わない) — 住所LODの実データでは丁目境界が完全一致する座標で
// digitizeされていることを確認済みのため、この前提で十分。
function hasSharedEdge(rings: number[][][]): boolean {
  const seen = new Set<string>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if (seen.has(`${x2},${y2}|${x1},${y1}`)) return true;
      seen.add(`${x1},${y1}|${x2},${y2}`);
    }
  }
  return false;
}

const pointKey = (p: number[]): string => `${p[0]},${p[1]}`;

// 複数のリングを、完全一致する(向きが逆の)辺同士をキャンセルして1つ(または
// 複数)のリングに結合する。新しい座標を一切計算せず、生き残った辺の端点
// (=入力データの座標オブジェクトそのもの)を繋ぎ直すだけなので、内部の
// 継ぎ目以外の頂点は常に入力と完全に一致する。
function dissolveRings(rings: number[][][]): number[][][] {
  const edges: [number[], number[]][] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      edges.push([ring[i], ring[i + 1]]);
    }
  }

  // 前方向のキーで未キャンセルの辺を記録しておき、逆向きのキーに一致する
  // 辺が現れたら両方をキャンセルする(=内部の継ぎ目として除去)。
  const pendingByForwardKey = new Map<string, number>();
  const cancelled = new Set<number>();
  edges.forEach(([a, b], i) => {
    const forwardKey = `${pointKey(a)}|${pointKey(b)}`;
    const reverseKey = `${pointKey(b)}|${pointKey(a)}`;
    const pendingIndex = pendingByForwardKey.get(reverseKey);
    if (pendingIndex !== undefined) {
      cancelled.add(i);
      cancelled.add(pendingIndex);
      pendingByForwardKey.delete(reverseKey);
    } else {
      pendingByForwardKey.set(forwardKey, i);
    }
  });

  const survivingEdges = edges.filter((_, i) => !cancelled.has(i));

  // 残った辺の始点をキーに引けるようにしておき、終点から次の辺へと
  // 繋いでいく(=元のポリゴンの外周を辿る)。
  const byStartKey = new Map<string, [number[], number[]]>();
  for (const edge of survivingEdges) {
    byStartKey.set(pointKey(edge[0]), edge);
  }

  const usedStartKeys = new Set<string>();
  const resultRings: number[][][] = [];
  for (const edge of survivingEdges) {
    const startKey = pointKey(edge[0]);
    if (usedStartKeys.has(startKey)) continue;

    const ring: number[][] = [edge[0]];
    let current = edge;
    while (true) {
      ring.push(current[1]);
      usedStartKeys.add(pointKey(current[0]));
      if (pointKey(current[1]) === pointKey(ring[0])) break; // 出発点に戻った=閉じた
      const next = byStartKey.get(pointKey(current[1]));
      if (!next) break; // 通常発生しない安全弁(不正な入力への保険)
      current = next;
    }
    resultRings.push(ring);
  }

  return resultRings;
}
