import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSparqlQuery } from "../lib/addressLod/sparql.js";
import { escapeSparqlLiteral } from "../lib/addressLod/uri.js";
import { hasVariantCharacter, buildVariantAwareRegexPattern } from "../lib/addressLod/variantCharacters.js";
import { AddressLodError } from "../lib/addressLod/errors.js";

const inputSchema = {
  query: z
    .string()
    .min(2)
    .describe("検索したい住所文字列の一部(例: '永田町')"),
  prefecture: z
    .string()
    .optional()
    .describe(
      "都道府県名で絞り込む(例: '東京都')。指定を強く推奨する。未指定は全国スキャンになり低速。"
    ),
  limit: z.number().int().min(1).max(100).default(20),
};

export async function searchAddress({
  query,
  prefecture,
  limit,
}: {
  query: string;
  prefecture?: string;
  limit: number;
}) {
  const prefectureFilter = prefecture
    ? `?address ic:都道府県 "${escapeSparqlLiteral(prefecture)}"@ja.\n  `
    : "";
  // 「ケ/ヶ/ヵ」等、既知の異体字を含むqueryはCONTAINSでは書き分けを吸収できない
  // (別のUnicode文字なので単純な部分文字列一致では一致しない)。その場合だけ
  // REGEXに切り替えて文字クラスで両方拾う。異体字を含まない大多数のケースは
  // 従来通りCONTAINSのままにして性能を落とさない。
  const labelFilter = hasVariantCharacter(query)
    ? `FILTER(REGEX(?label, "${escapeSparqlLiteral(buildVariantAwareRegexPattern(query))}"))`
    : `FILTER(CONTAINS(?label, "${escapeSparqlLiteral(query)}"))`;
  const sparql = `
PREFIX ic:   <http://imi.go.jp/ns/core/rdf#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?address ?label WHERE {
  ?address a ic:住所型; rdfs:label ?label.
  ${prefectureFilter}${labelFilter}
}
LIMIT ${limit}`.trim();

  try {
    const rows = await executeSparqlQuery(sparql);
    const results = rows.map((row) => ({ uri: row.address, label: row.label }));

    const notes: string[] = [];
    if (!prefecture) {
      notes.push(
        "prefectureを指定していないため全国を検索した(低速)。次回は絞り込みを推奨。"
      );
    }
    if (results.length === 0) {
      notes.push("該当する住所が見つからなかった。queryを短く/prefectureを変えて再検索を検討。");
    } else {
      notes.push(
        "形状(ポリゴン/ポイント)が必要な場合は、候補のuriを get_address_location に渡すこと。"
      );
    }

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
          text: `住所検索に失敗した: ${message} prefectureを指定するか、queryをより具体的にして再試行すること。`,
        },
      ],
    };
  }
}

export function registerSearchAddressTool(server: McpServer): void {
  server.registerTool(
    "search_address",
    {
      title: "住所を検索",
      description:
        "住所LODを使って、住所ラベルの部分一致で候補を検索する。" +
        "「ケ/ヶ/ヵ」等の異体字表記ゆれは自動的に吸収する。" +
        "形状(ポリゴン/ポイント)が必要な場合は、結果のURIを get_address_location に渡すこと。",
      inputSchema,
    },
    searchAddress
  );
}
