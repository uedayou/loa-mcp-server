import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../../../core/profile.js";
import { LodError } from "../../../core/errors.js";
import { findChildren, type SortBy } from "../children.js";
import { POPULATION_REFERENCE_NOTE } from "../population.js";

const inputSchema = {
  parent: z
    .string()
    .describe(
      "親となる住所文字列またはURI(例: '東京都'、'東京都新宿区')。" +
        "都道府県→市区町村(→行政区)→町丁目の階層のみ辿れる。丁目より下(番地)は対象外。" +
        "「〇〇郡△△町」の郡名や、政令指定都市の市名の省略(例: '東京都瑞穂町'、'神奈川県南区')、" +
        "「ケ/ヶ/ヵ」等の異体字表記ゆれは自動的に補完を試みる。"
    ),
  limit: z.number().int().min(1).max(200).default(100),
  sortBy: z
    .enum(["none", "population", "households"])
    .default("none")
    .describe(
      "並べ替え。'population'/'households'で人口・世帯数(2020年国勢調査の参考値)の多い順。" +
        "上限(limit)の範囲内ではなく、全子要素のうち上位limit件が返るため「人口の多い区トップ5」等に使える。" +
        "人口データがない子要素は末尾に回る。既定'none'は従来どおり順不同。"
    ),
};

export async function listChildAddresses({
  parent,
  limit,
  sortBy = "none",
}: {
  parent: string;
  limit: number;
  sortBy?: SortBy;
}) {
  try {
    const { children: results, note } = await findChildren(parent, limit, sortBy);

    const content = [{ type: "text" as const, text: JSON.stringify(results) }];
    if (note) content.push({ type: "text" as const, text: note });
    // limit ちょうどの件数が返ったときは、それ以上の子が黙って欠けている可能性がある。
    if (results.length >= limit) {
      content.push({
        type: "text" as const,
        text:
          `limit(${limit}件)いっぱいまで返ったため、これより多くの子要素がある可能性がある(このToolは最大200件まで)。` +
          "親の全ての子の位置をGeoJSONファイルとして保存したい場合は save_child_address_locations_to_file を使うこと" +
          "(件数の上限はこのToolより大きい)。",
      });
    }
    if (results.some((r) => r.population !== undefined || r.households !== undefined)) {
      content.push({ type: "text" as const, text: POPULATION_REFERENCE_NOTE });
    }
    return { content };
  } catch (error) {
    const message =
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `子要素一覧の取得に失敗した: ${message}` }],
    };
  }
}

export function registerListChildAddressesTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.list_child;
  server.registerTool(
    t?.name ?? "list_child_addresses",
    {
      title: t?.title ?? "",
      description: t?.description ?? "",
      inputSchema,
    },
    listChildAddresses
  );
}
