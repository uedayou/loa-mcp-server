import "dotenv/config";

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const config = {
  serverName: readEnv("MCP_SERVER_NAME", "loa-mcp-server"),
  serverVersion: readEnv("MCP_SERVER_VERSION", "0.1.0"),
  addressLod: {
    baseUrl: readEnv("ADDRESS_LOD_BASE_URL", "https://uedayou.net/loa/"),
    sparqlEndpoint: readEnv(
      "ADDRESS_LOD_SPARQL_ENDPOINT",
      "https://uedayou.net/loa/sparql/query"
    ),
    timeoutMs: Number(readEnv("ADDRESS_LOD_TIMEOUT_MS", "10000")),
    sparqlTimeoutMs: Number(readEnv("ADDRESS_LOD_SPARQL_TIMEOUT_MS", "15000")),
    // reverse_geocode_address の都道府県geohashキャッシュ(Stage 1)のTTL。
    prefectureCacheTtlMs: Number(readEnv("ADDRESS_LOD_PREF_CACHE_TTL_MS", "86400000")),
  },
} as const;

// 住所LODへのすべてのHTTPリクエストに付与するUser-Agent。既定のNode.js UA
// (単に"node")だと発信元が分からないため、このサーバー自身を名乗る。
export const userAgent = `${config.serverName}/${config.serverVersion}`;
