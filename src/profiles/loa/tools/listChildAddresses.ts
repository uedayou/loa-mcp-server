import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../../../core/profile.js";
import { LodError } from "../../../core/errors.js";
import { profile as activeProfile, runSparql, normalizePath, toIri } from "../context.js";
import { LOAP_JINKO, LOAP_SETAI } from "../vocab.js";
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

export type SortBy = "none" | "population" | "households";

function childrenQuery(parentPath: string, limit: number, sortBy: SortBy): string {
  const v = activeProfile.vocab;
  const parentIri = toIri(parentPath);
  // 実測(2026-09-30): 住所LODの SPARQL エンドポイントでは「型制約(a ic:住所型)+ORDER BY」の
  // 組み合わせだけが約1.3秒かかり(親の子要素数によらず一定)、型制約を外すと約20ms(60倍速)。
  // ont:parentFeature の子は全て住所エンティティなので、型制約の有無で結果集合は変わらない
  // (神奈川県/東京都/北海道/政令市/町丁目など8親で完全一致を確認)。並べ替え時のみ外す。
  const typeConstraint =
    v.entityTypeIri && sortBy === "none" ? `a <${v.entityTypeIri}>; ` : "";
  const hierarchyClause = v.childToParentIri
    ? `?child ${typeConstraint}<${v.labelIri}> ?label; <${v.childToParentIri}> ${parentIri}.`
    : `${parentIri} <${v.parentToChildIri}> ?child. ?child <${v.labelIri}> ?label.`;
  // 人口・世帯数は SPARQL エンドポイントの独自語彙 loap:。丁目・番地には付かないため OPTIONAL。
  const optionals =
    `\n  OPTIONAL { ?child <${LOAP_JINKO}> ?population }` +
    `\n  OPTIONAL { ?child <${LOAP_SETAI}> ?households }`;
  // DESC 並べ替えでは未バインド(人口データなし)は SPARQL 仕様上自動的に末尾になる。
  const orderBy = sortBy === "none" ? "" : `\nORDER BY DESC(?${sortBy})`;
  return `SELECT ?child ?label ?population ?households WHERE {\n  ${hierarchyClause}${optionals}\n}${orderBy}\nLIMIT ${limit}`;
}

export interface ChildAddress {
  uri: string;
  label: string;
  population?: number;
  households?: number;
}

async function fetchChildren(
  parentPath: string,
  limit: number,
  sortBy: SortBy
): Promise<ChildAddress[]> {
  const rows = await runSparql(childrenQuery(parentPath, limit, sortBy));
  return rows.map((row) => {
    const child: ChildAddress = { uri: row.child, label: row.label };
    if (row.population !== undefined) child.population = Number(row.population);
    if (row.households !== undefined) child.households = Number(row.households);
    return child;
  });
}

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
    const entityPath = normalizePath(parent);
    let results = await fetchChildren(entityPath, limit, sortBy);
    let note: string | undefined;

    // SPARQL は dereference と別実装(簡略化グラフ)のため resolveEntity は使えない。
    // 同じ profile.resolution.fallbacks を使って候補を生成し、SPARQL を再試行する。
    if (results.length === 0) {
      for (const fallback of activeProfile.resolution?.fallbacks ?? []) {
        const outcome = fallback.run(entityPath, parent);
        if (outcome.type === "ambiguous") {
          // Tool 固有の言い回し(実務的 B-mid: インライン既定)。
          note =
            `"${parent}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ` +
            `${outcome.labels.join("、")}。いずれかの正式名を指定して再試行すること。`;
          break;
        }
        if (outcome.type === "candidates") {
          for (const candidatePath of outcome.paths) {
            const retry = await fetchChildren(candidatePath, limit, sortBy);
            if (retry.length > 0) {
              results = retry;
              note = outcome.note(candidatePath);
              break;
            }
          }
          if (results.length > 0) break;
        }
      }
    }

    const content = [{ type: "text" as const, text: JSON.stringify(results) }];
    if (note) content.push({ type: "text" as const, text: note });
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
