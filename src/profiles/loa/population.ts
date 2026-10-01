import type { QuadIndex } from "../../core/profile.js";
import {
  SCHEMA_ADDITIONAL_PROPERTY,
  SCHEMA_PROPERTY_ID,
  SCHEMA_VALUE,
  LOA_PROPERTY_ID_JINKO,
  LOA_PROPERTY_ID_SETAI,
} from "./vocab.js";

// 個別 .ttl の schema:additionalProperty(PropertyValue の blank node)から
// 人口・世帯数(2020年国勢調査の参考値)を取り出す customExtract フック。
// 人口0の無人地域は 0 を返し、データ自体がないエンティティ(e-Stat に対応なし)は
// キーを出さない(0 と「データなし」を区別する)。kbsum は出力しない。
export function extractPopulation(
  quadsBySubject: QuadIndex,
  subjectIri: string
): { population?: number; households?: number } {
  const result: { population?: number; households?: number } = {};
  const triples = quadsBySubject.get(subjectIri) ?? [];

  for (const t of triples) {
    if (t.predicate !== SCHEMA_ADDITIONAL_PROPERTY) continue;
    const node = quadsBySubject.get(t.object.value) ?? [];
    const id = node.find((n) => n.predicate === SCHEMA_PROPERTY_ID)?.object.value;
    const raw = node.find((n) => n.predicate === SCHEMA_VALUE)?.object.value;
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;

    if (id === LOA_PROPERTY_ID_JINKO) result.population = value;
    else if (id === LOA_PROPERTY_ID_SETAI) result.households = value;
  }

  return result;
}

/**
 * GeoJSON 本体(Feature / FeatureCollection)に参考値注記を埋め込む。
 * 別テキストブロックの注記は LLM が最終回答で省略しうるほか、save_address_locations_to_file
 * のファイルには含まれない。GeoJSON(RFC 7946)は未知の foreign member を許容するため、
 * population を含むときだけ `population_note` をトップレベルに足し、データ自体に注意書きが
 * 付いて回るようにする。含まないときは何も足さず従来と同じ出力になる。
 */
export function withPopulationNote<T extends object>(
  geojson: T,
  features: readonly { properties: Record<string, unknown> }[]
): T | (T & { population_note: string }) {
  return features.some((f) => typeof f.properties.population === "number")
    ? { ...geojson, population_note: POPULATION_REFERENCE_NOTE }
    : geojson;
}

export const POPULATION_REFERENCE_NOTE =
  "population/householdsは2020年国勢調査の基本単位区の値を機械的に合算した参考値であり、公式統計値そのものではない" +
  "(国勢調査の基本単位区の境界と住居表示上の町名・丁目の境界は完全には一致しない場合がある)。" +
  "利用者へ人口・世帯数を回答・表・地図の凡例などで示すときは、「参考値」「2020年国勢調査ベース」である旨を必ず併記すること。";
