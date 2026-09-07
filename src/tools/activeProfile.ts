// このリポジトリで有効なプロファイル(loa のみ)。共通 Tool はここから
// { profile, ctx } と補助関数を取る。フォークはこの1ファイルと server.ts の
// import を差し替えるだけで済む(design-multi-lod-generalization.md §5.1)。
import { loaProfile, loaContext } from "../profiles/loa/index.js";
import { executeSparqlQuery } from "../core/sparql.js";

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
