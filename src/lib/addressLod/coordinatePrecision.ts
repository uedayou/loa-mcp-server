import type { GeoJsonGeometry } from "./wkt.js";

// 住所LODの元データは小数点第7位(緯度経度で約1.1cm精度)だが、行政境界の
// 表示用途にそこまでの精度は不要(一般的なGPS実測精度である2〜3mよりも
// はるかに精密)。第6位(約11cm精度)に丸めることで、実用上の精度をほぼ
// 落とさずに出力サイズを削減できる(実測: 新宿区のポリゴンで約8%削減、
// `JSON.stringify`のコンパクト化と合わせて累積的に効く)。
//
// simplify:"high"(RDPの許容誤差0.001度≈100m、トポロジーsimplifyも同程度に
// 積極的な間引き)を指定したときだけ、第5位(約1.1m精度)まで丸める。5桁と
// 6桁の丸め誤差の差は最大でも約0.55mで、highが既に許容している数十〜100m
// 規模の形状誤差に比べて無視できる規模(実測・裏付けはdesign-polygon-
// simplification.md参照)。それ以外のsimplifyレベル(既定の精度を保ちたい
// 用途)では従来通り第6位に丸める。
//
// 丸めは常にJSON化直前の最終ステップでのみ適用する。simplify・重心計算・
// dissolve(union)といった内部処理はすべて丸め前の元の精度で行われており、
// 丸めた座標を入力にすると誤差が蓄積するため。
const DEFAULT_DECIMAL_PLACES = 6;
const HIGH_SIMPLIFY_DECIMAL_PLACES = 5;

export function decimalPlacesFor(simplifyLevel: string | undefined): number {
  return simplifyLevel === "high" ? HIGH_SIMPLIFY_DECIMAL_PLACES : DEFAULT_DECIMAL_PLACES;
}

function round(n: number, decimalPlaces: number): number {
  return Number(n.toFixed(decimalPlaces));
}

// lat/long(properties)側は値そのものが存在しないことがあるため、undefinedを
// そのまま通す別関数として分ける(geometry.coordinatesの要素は常にnumberの
// ため、下のroundGeometry()と同じdecimalPlacesを渡して統一する)。
export function roundCoordinate(
  n: number | undefined,
  decimalPlaces: number = DEFAULT_DECIMAL_PLACES
): number | undefined {
  return n === undefined ? undefined : round(n, decimalPlaces);
}

export function roundGeometry(
  geometry: GeoJsonGeometry,
  decimalPlaces: number = DEFAULT_DECIMAL_PLACES
): GeoJsonGeometry {
  const r = (n: number) => round(n, decimalPlaces);
  if (geometry.type === "Point") {
    return { type: "Point", coordinates: geometry.coordinates.map(r) };
  }
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) => ring.map((p) => p.map(r))),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map((p) => p.map(r)))
    ),
  };
}
