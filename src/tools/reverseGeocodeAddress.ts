import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSparqlQuery } from "../lib/addressLod/sparql.js";
import { escapeSparqlLiteral } from "../lib/addressLod/uri.js";
import { encodeGeohash } from "../lib/addressLod/geohash.js";
import {
  getPrefectureGeohashes,
  findBestPrefectureMatch,
} from "../lib/addressLod/prefectureGeohashCache.js";
import { AddressLodError } from "../lib/addressLod/errors.js";

const inputSchema = {
  lat: z.number().min(-90).max(90).describe("緯度(WGS84)"),
  long: z.number().min(-180).max(180).describe("経度(WGS84)"),
  precision: z
    .number()
    .int()
    .min(4)
    .max(6)
    .default(5)
    .describe(
      "geohash前方一致の桁数(5=約4.9km四方、6=約1.2km×0.6km)。" +
        "SPARQL上に丁目・番地のgeohashは存在しないため、これより細かい精度(号・番地レベル)は特定できない。"
    ),
};

async function runGeohashQuery(
  geohashPrefix: string,
  prefectureLabel?: string
): Promise<Record<string, string>[]> {
  const prefectureFilter = prefectureLabel
    ? `?address ic:都道府県 "${escapeSparqlLiteral(prefectureLabel)}"@ja.\n  `
    : "";
  // geohashPrefix is always our own encodeGeohash() output (base32 charset
  // only: 0-9, a-z minus a/i/l/o), so it is safe to embed directly as a
  // prefixed-name local part without escaping — it never contains
  // user-controlled text.
  const sparql = `
PREFIX ic:    <http://imi.go.jp/ns/core/rdf#>
PREFIX schema:<http://schema.org/>
PREFIX geoh:  <http://geohash.org/>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?address ?label WHERE {
  ?address a ic:住所型; rdfs:label ?label; schema:geo ?geo.
  ${prefectureFilter}FILTER(STRSTARTS(STR(?geo), STR(geoh:${geohashPrefix})))
}
LIMIT 100`.trim();
  return executeSparqlQuery(sparql);
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
    // Compute once at the finest precision the store actually indexes
    // (town-level, 6 chars) and slice down to what the caller asked for.
    const inputGeohash = encodeGeohash(lat, long, 6);
    const targetPrefix = inputGeohash.slice(0, precision);

    let rows: Record<string, string>[] = [];
    let usedPrefecture: string | null = null;

    // Stage 1 (fast path): narrow to a candidate prefecture via a cached
    // geohash lookup, then run Stage 2 scoped by it. This is a *hint*, not a
    // guarantee — some prefectures (e.g. 東京都, whose stored representative
    // point falls near the Ogasawara Islands rather than central Tokyo) have
    // geographically misleading representative points, so a wrong guess is
    // expected occasionally. Because the STRSTARTS filter is always derived
    // from the real input coordinates regardless of which prefecture we
    // scoped by, a wrong guess can only ever yield zero rows, never wrong
    // rows — so it's safe to fall through to the unscoped search below.
    try {
      const prefectures = await getPrefectureGeohashes();
      const match = findBestPrefectureMatch(inputGeohash, prefectures);
      if (match) {
        rows = await runGeohashQuery(targetPrefix, match.label);
        if (rows.length > 0) {
          usedPrefecture = match.label;
        }
      }
    } catch {
      // Stage 1 cache/lookup failure must not block the Stage 2 fallback.
    }

    // Stage 2 (fallback): unscoped search. Slower (measured 3-11s in
    // production) but always correct.
    if (rows.length === 0) {
      rows = await runGeohashQuery(targetPrefix);
    }

    const results = rows.map((row) => ({ uri: row.address, label: row.label }));
    const notes = [
      usedPrefecture
        ? `候補都道府県を${usedPrefecture}に絞り込んで検索した。`
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
      error instanceof AddressLodError
        ? error.message
        : `Unexpected error: ${(error as Error).message}`;
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

export function registerReverseGeocodeAddressTool(server: McpServer): void {
  server.registerTool(
    "reverse_geocode_address",
    {
      title: "緯度経度から近傍住所を検索(逆ジオコーディング)",
      description:
        "緯度経度から近傍の町丁目レベルの住所候補を検索する。精度上限は町丁目レベル(SPARQL上に丁目・番地のgeohashが" +
        "存在しないため)。都道府県境界付近などでは候補が漏れる可能性がある近似検索であり、点在ジオコーディング(点→行政区画の" +
        "厳密な判定)ではない。",
      inputSchema,
    },
    reverseGeocodeAddress
  );
}
