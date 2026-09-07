import { SparqlError } from "./errors.js";

// SPARQL SELECT の実行(design-multi-lod-generalization.md §3.9)。
// クエリ文字列は呼び出し側(共通 tools / helpers / プロファイル所有 tool)が
// 組み立てる。ここはエンドポイントの叩き方だけを知る。

export interface SparqlRequestConfig {
  endpoint: string;
  timeoutMs: number;
  userAgent: string;
  /** "auto" = 通常 GET、エンコード後URLが約2000字を超えたら POST(§3.9)。 */
  httpMethod?: "GET" | "POST" | "auto";
  postContentType?: "application/x-www-form-urlencoded" | "application/sparql-query";
}

// エンコード後の `?query=` を含む URL がこの長さを超えたら POST に切り替える。
// 2,000 は実運用上ほぼ全てのサーバー/プロキシが GET で許容する安全側の値。
// loa が生成するクエリはすべて数百字なので "auto" では常に GET のまま。
const GET_URL_LIMIT = 2000;

interface SparqlJsonResult {
  results: { bindings: { [variable: string]: { type: string; value: string } }[] };
}

export async function executeSparqlQuery(
  query: string,
  cfg: SparqlRequestConfig
): Promise<Record<string, string>[]> {
  const encoded = encodeURIComponent(query);
  const getUrl = `${cfg.endpoint}?query=${encoded}`;
  const method = cfg.httpMethod ?? "auto";
  const usePost = method === "POST" || (method === "auto" && getUrl.length > GET_URL_LIMIT);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let response: Response;
  try {
    if (usePost) {
      const postContentType = cfg.postContentType ?? "application/x-www-form-urlencoded";
      response = await fetch(cfg.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": cfg.userAgent,
          "Content-Type": postContentType,
        },
        body:
          postContentType === "application/sparql-query" ? query : `query=${encoded}`,
        signal: controller.signal,
      });
    } else {
      response = await fetch(getUrl, {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": cfg.userAgent,
        },
        signal: controller.signal,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SparqlError(`SPARQL query timed out after ${cfg.timeoutMs}ms`);
    }
    throw new SparqlError(`SPARQL request errored: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new SparqlError(`SPARQL query failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as SparqlJsonResult;
  return json.results.bindings.map((binding) => {
    const row: Record<string, string> = {};
    for (const [variable, term] of Object.entries(binding)) {
      row[variable] = term.value;
    }
    return row;
  });
}

// SPARQL 文字列リテラル("...")への埋め込み用エスケープ。旧 uri.ts から移設。
export function escapeSparqlLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
