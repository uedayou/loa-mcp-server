// loa プロファイルの実行時コンテキスト。profiles/loa/tools/ の各 Tool は
// ここから { profile, ctx } と補助関数を取る。フォーク先は profiles/<id>/
// ディレクトリを丸ごと差し替える(design-tools-layer-generalization.md §3)。
import { loaProfile, loaContext } from "./index.js";
import { executeSparqlQuery } from "../../core/sparql.js";

export const profile = loaProfile;
export const ctx = loaContext;

/** SPARQL 文字列を有効プロファイルのエンドポイント設定で実行する。 */
export function runSparql(query: string): Promise<Record<string, string>[]> {
  return executeSparqlQuery(query, {
    endpoint: ctx.sparqlEndpoint,
    timeoutMs: ctx.sparqlTimeoutMs,
    userAgent: ctx.userAgent,
    httpMethod: ctx.sparqlHttpMethod,
    postContentType: ctx.sparqlPostContentType,
  });
}

/** 入力文字列 → 素のエンティティパス(identifier.normalize + inputNormalizers)。 */
export function normalizePath(input: string): string {
  let path = profile.identifier.normalize(input, ctx);
  for (const normalize of profile.resolution?.inputNormalizers ?? []) {
    path = normalize(path);
  }
  return path;
}

/** エンティティパス → SPARQL 埋め込み用の完全 IRI("<...>")。 */
export function toIri(path: string): string {
  return profile.identifier.toIri(path, ctx);
}
