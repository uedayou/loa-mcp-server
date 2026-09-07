import type { GeoJsonGeometry } from "../geo/wkt.js";

// 旧 AddressFeature の一般化(design-multi-lod-generalization.md §7)。
// properties は「必ずある既知キー + プロファイルの propertyMap / customExtract
// が足す任意キー」の形。loa では従来と同じキー(prefecture / municipality /
// town / chome / banchi / notation / address_code)が propertyMap により
// そのまま入る。

/** propertyMap / customExtract が properties に入れうる値。RDF リテラル由来の
 *  文字列・数値が大半だが、customExtract は観測値の配列など入れ子も返せる。 */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | PropertyValue[]
  | { [key: string]: PropertyValue };

export interface EntityProperties {
  /** サーバーが実際に解決した URI(要求パスと異なることがある)。 */
  uri: string;
  /** labelIri の値。 */
  name?: string;
  /** 代表点。wgs:lat/long があればその値、なければ centroid 補完値。 */
  lat?: number;
  long?: number;
  /** "centroid" のときのみ。lat/long がポリゴン重心からの近似であることを示す。 */
  point_source?: "centroid";
  /** propertyMap / customExtract が足す任意のプロパティ。 */
  [key: string]: PropertyValue | undefined;
}

export interface EntityFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: EntityProperties;
}
