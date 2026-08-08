import type { AddressFeature } from "./ttl.js";
import { simplifyGeometry, countGeometryPoints, type SimplifyLevel } from "./simplify.js";
import { roundGeometry, roundCoordinate, decimalPlacesFor } from "./coordinatePrecision.js";

// get_address_location / get_address_locations共通の「取得したFeatureをそのまま
// 返す前に、simplify適用と付随する説明テキスト(注記)を組み立てる」処理。

export function applySimplify(feature: AddressFeature, level: SimplifyLevel | undefined) {
  if (!level || level === "none" || !feature.geometry) {
    return { feature, note: undefined as string | undefined };
  }
  const originalPoints = countGeometryPoints(feature.geometry);
  const simplifiedGeometry = simplifyGeometry(feature.geometry, level);
  const simplifiedPoints = countGeometryPoints(simplifiedGeometry);
  return {
    feature: { ...feature, geometry: simplifiedGeometry },
    note: `simplify:'${level}' で座標点数を ${originalPoints} → ${simplifiedPoints} に間引いた(形状は近似)。`,
  };
}

// 都道府県・市区町村・一部の町丁目レベルは住所LODがwgs:lat/longを持たないため、
// ttl.tsがポリゴンの重心で代表点を補完している(`properties.point_source`)。
// 呼び出し側に「近似値である」ことを伝える注記を added する。
export function pointSourceNote(feature: AddressFeature): string | undefined {
  return feature.properties.point_source === "centroid"
    ? "代表点(lat/long)は住所LODに存在しないため、ポリゴンの重心から算出した近似値。"
    : undefined;
}

// Claude Desktopで「地図に表示して」という依頼に対し、LLMが座標変換や
// SVGでの手動描画を自前で組み立てようとする(不要かつ非効率な)ケースが
// 実際に観測されたため、結果が標準的なGeoJSONでありそのまま地図ライブラリに
// 渡せることを明示する注記を毎回添える。
export function renderingHintNote(feature: AddressFeature): string | undefined {
  return feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon"
    ? "geometryは標準的なGeoJSON。Leafletの L.geoJSON()、MapLibre GL JS、deck.gl等のGeoJSON対応の地図ライブラリにそのまま渡して表示できる。座標変換やSVGでの手動描画は不要。"
    : undefined;
}

// 座標をJSON化直前の第6位(約11cm精度)に丸める。simplify:"high"のときだけ
// 第5位(約1.1m精度)まで丸める(decimalPlacesFor参照)。simplify等の内部処理は
// すべてこの丸めより前に、元の精度のまま行われている。
export function roundFeatureCoordinates(
  feature: AddressFeature,
  level: SimplifyLevel | undefined
): AddressFeature {
  const decimalPlaces = decimalPlacesFor(level);
  return {
    ...feature,
    geometry: feature.geometry ? roundGeometry(feature.geometry, decimalPlaces) : null,
    properties: {
      ...feature.properties,
      lat: roundCoordinate(feature.properties.lat, decimalPlaces),
      long: roundCoordinate(feature.properties.long, decimalPlaces),
    },
  };
}

export function finalizeFeature(feature: AddressFeature, level: SimplifyLevel | undefined) {
  const psNote = pointSourceNote(feature);
  const { feature: simplifiedFeature, note: simplifyNote } = applySimplify(feature, level);
  const renderNote = renderingHintNote(simplifiedFeature);
  const notes = [psNote, simplifyNote, renderNote].filter((n): n is string => Boolean(n));
  return { feature: roundFeatureCoordinates(simplifiedFeature, level), notes };
}
