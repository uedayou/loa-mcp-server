import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { LodError } from "../core/errors.js";
import { escapeSparqlLiteral } from "../core/sparql.js";
import { encodeGeohash } from "../geo/geohash.js";
import { GEOHASH_NS } from "../profiles/loa/vocab.js";
import { profile as activeProfile, runSparql } from "./activeProfile.js";

// プロファイル所有 Tool(design §3.11)。geohash 前方一致による近傍検索。
// loa は Stage1(都道府県 geohash キャッシュで絞り込み)→ Stage2(全国)の2段。
// 絞り込みフックは profile.geohashNearby.narrowScope。

const gp = activeProfile.vocab.geometry.geohashPrecision ?? { min: 4, max: 6, default: 5 };

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("緯度(WGS84)"),
  long: z.number().min(-180).max(180).describe("経度(WGS84)"),
  precision: z
    .number()
    .int()
    .min(gp.min)
    .max(gp.max)
    .default(gp.default)
    .describe(
      "geohash前方一致の桁数(5=約4.9km四方、6=約1.2km×0.6km)。" +
        "SPARQL上に丁目・番地のgeohashは存在しないため、これより細かい精度(号・番地レベル)は特定できない。"
    ),
};

async function runGeohashQuery(
  geohashPrefix: string,
  scope: { predicate: string; value: string } | null
): Promise<Record<string, string>[]> {
  const v = activeProfile.vocab;
  const lang = v.labelLang ? `@${v.labelLang}` : "";
  const scopeFilter = scope
    ? `?address <${scope.predicate}> "${escapeSparqlLiteral(scope.value)}"${lang}.\n  `
    : "";
  const typeConstraint = v.entityTypeIri ? `a <${v.entityTypeIri}>; ` : "";
  const sparql = `
SELECT ?address ?label WHERE {
  ?address ${typeConstraint}<${v.labelIri}> ?label; <${v.geometry.geohashIri}> ?geo.
  ${scopeFilter}FILTER(STRSTARTS(STR(?geo), STR(<${GEOHASH_NS}${geohashPrefix}>)))
}
LIMIT 100`.trim();
  return runSparql(sparql);
}

export async function reverseGeocodeAddress({
  lat,
  long,
  precision,
}: {
  lat: number;
  long: number;
  precision: number;
}) {
  try {
    const inputGeohash = encodeGeohash(lat, long, 6);
    const targetPrefix = inputGeohash.slice(0, precision);

    let rows: Record<string, string>[] = [];
    let usedScopeValue: string | null = null;

    // Stage 1(高速パス): narrowScope フックで候補を1つ引き当てて絞り込む。
    // 外れても0件になるだけで誤った候補は返らない(STRSTARTS は常に入力座標由来)。
    try {
      const scope = (await activeProfile.geohashNearby?.narrowScope?.(inputGeohash)) ?? null;
      if (scope) {
        rows = await runGeohashQuery(targetPrefix, scope);
        if (rows.length > 0) usedScopeValue = scope.value;
      }
    } catch {
      // Stage 1 の失敗は Stage 2 を妨げない。
    }

    // Stage 2(フォールバック): スコープなしの全国検索。低速だが常に正しい。
    if (rows.length === 0) {
      rows = await runGeohashQuery(targetPrefix, null);
    }

    const results = rows.map((row) => ({ uri: row.address, label: row.label }));
    const notes = [
      usedScopeValue
        ? `候補都道府県を${usedScopeValue}に絞り込んで検索した。`
        : "都道府県を絞り込めなかったため全国を検索した(低速)。",
      "町丁目レベルの近似候補であり、番地・建物レベルの特定はできない。",
      "より正確な位置が必要な場合は get_address_location や list_child_addresses で絞り込むこと。",
    ];

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results) },
        { type: "text" as const, text: notes.join(" ") },
      ],
    };
  } catch (error) {
    const message =
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `逆ジオコーディングに失敗した: ${message} ` +
            "precisionを下げるか、しばらく待って再試行すること。",
        },
      ],
    };
  }
}

export function registerReverseGeocodeAddressTool(
  server: McpServer,
  profile: DatasetProfile
): void {
  const t = profile.toolText.geohash_nearby;
  server.registerTool(
    t?.name ?? "reverse_geocode_address",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    reverseGeocodeAddress
  );
}
