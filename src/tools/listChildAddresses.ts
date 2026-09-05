import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { LodError } from "../core/errors.js";
import { profile as activeProfile, runSparql, normalizePath, toIri } from "./activeProfile.js";

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
};

function childrenQuery(parentPath: string, limit: number): string {
  const v = activeProfile.vocab;
  const parentIri = toIri(parentPath);
  const typeConstraint = v.entityTypeIri ? `a <${v.entityTypeIri}>; ` : "";
  const hierarchyClause = v.childToParentIri
    ? `?child ${typeConstraint}<${v.labelIri}> ?label; <${v.childToParentIri}> ${parentIri}.`
    : `${parentIri} <${v.parentToChildIri}> ?child. ?child <${v.labelIri}> ?label.`;
  return `SELECT ?child ?label WHERE {\n  ${hierarchyClause}\n}\nLIMIT ${limit}`;
}

async function fetchChildren(parentPath: string, limit: number) {
  const rows = await runSparql(childrenQuery(parentPath, limit));
  return rows.map((row) => ({ uri: row.child, label: row.label }));
}

export async function listChildAddresses({ parent, limit }: { parent: string; limit: number }) {
  try {
    const entityPath = normalizePath(parent);
    let results = await fetchChildren(entityPath, limit);
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
            const retry = await fetchChildren(candidatePath, limit);
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
