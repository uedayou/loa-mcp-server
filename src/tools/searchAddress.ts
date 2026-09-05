import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { LodError } from "../core/errors.js";
import { escapeSparqlLiteral } from "../core/sparql.js";
import {
  hasVariantCharacter,
  buildVariantAwareRegexPattern,
} from "../profiles/loa/resolution/variantCharacters.js";
import { profile as activeProfile, runSparql } from "./activeProfile.js";

// プロファイル所有 Tool(汎用化しない、design §3.11 / §3.12)。loa は
// label CONTAINS + 都道府県スコープ + 異体字 REGEX 切替。フォークは自サイト用に
// 置き換える(検索軸・クエリ形はサイトごとに大きく異なるため)。

const inputSchema = {
  query: z.string().min(2).describe("検索したい住所文字列の一部(例: '永田町')"),
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
  const v = activeProfile.vocab;
  const lang = v.labelLang ? `@${v.labelLang}` : "";
  const prefPredicate = v.propertyMap.prefecture?.predicate;
  const prefectureFilter =
    prefecture && prefPredicate
      ? `?address <${prefPredicate}> "${escapeSparqlLiteral(prefecture)}"${lang}.\n  `
      : "";
  // 「ケ/ヶ/ヵ」等、既知の異体字を含む query は CONTAINS では書き分けを吸収できない
  // ため、その場合だけ REGEX に切り替えて文字クラスで両方拾う。
  const labelFilter = hasVariantCharacter(query)
    ? `FILTER(REGEX(?label, "${escapeSparqlLiteral(buildVariantAwareRegexPattern(query))}"))`
    : `FILTER(CONTAINS(?label, "${escapeSparqlLiteral(query)}"))`;
  const typeConstraint = v.entityTypeIri ? `a <${v.entityTypeIri}>; ` : "";
  const sparql = `
SELECT ?address ?label WHERE {
  ?address ${typeConstraint}<${v.labelIri}> ?label.
  ${prefectureFilter}${labelFilter}
}
LIMIT ${limit}`.trim();

  try {
    const rows = await runSparql(sparql);
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
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
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

export function registerSearchAddressTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.search;
  server.registerTool(
    t?.name ?? "search_address",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    searchAddress
  );
}
