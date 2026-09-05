// 移行アダプタ(フェーズ2d)。URI 正規化・IRI 構築は
// src/core/identifierStrategies.ts の stringConcatIdentifier(profiles/loa/identifier.ts)、
// SPARQL リテラルエスケープは src/core/sparql.ts が実体。
// 旧シグネチャ(引数1つ)を保つため loa プロファイルを注入。
import { loaProfile, loaContext } from "../../profiles/loa/index.js";

export { escapeSparqlLiteral } from "../../core/sparql.js";

// 住所文字列 / URL / 拡張子付き URL → 素のエンティティパス(数字表記の正規化込み)。
// 旧 normalizeToEntityPath と等価: identifier.normalize(strip) → inputNormalizers。
export function normalizeToEntityPath(address: string): string {
  let path = loaProfile.identifier.normalize(address, loaContext);
  for (const normalize of loaProfile.resolution?.inputNormalizers ?? []) {
    path = normalize(path);
  }
  return path;
}

export function toFullIri(entityPath: string): string {
  return loaProfile.identifier.toIri(entityPath, loaContext);
}
