// 移行シム(design/multi-lod-generalization フェーズ2d)。実体は src/core/sparql.ts。
// 旧シグネチャ executeSparqlQuery(query) を保つため、loa の設定を注入して呼ぶ。
// フェーズ3で共通 tools / helpers は core/sparql.ts を直接使い、このシムを撤去する。
import { config, userAgent } from "../../config.js";
import { executeSparqlQuery as coreExecute } from "../../core/sparql.js";

export function executeSparqlQuery(query: string): Promise<Record<string, string>[]> {
  return coreExecute(query, {
    endpoint: config.addressLod.sparqlEndpoint,
    timeoutMs: config.addressLod.sparqlTimeoutMs,
    userAgent,
    httpMethod: "auto",
    postContentType: "application/x-www-form-urlencoded",
  });
}
