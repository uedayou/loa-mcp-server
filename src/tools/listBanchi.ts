import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { LodError } from "../core/errors.js";
import { profile as activeProfile, runSparql, normalizePath, toIri } from "./activeProfile.js";

// list_subparts は住所ドメイン色が濃い(「番地」「丁目」の2段ネスト hasPart)。
// SPARQL のクエリ形は loa の構造をそのまま持つ。サブパート構造が異なるフォークは
// この Tool ごと置き換える想定(capability.subParts で gate、design §6)。
const inputSchema = {
  town: z
    .string()
    .describe(
      "町丁目レベルの住所文字列またはURI(丁目番号を含まない。例: '東京都新宿区歌舞伎町')。" +
        "「〇〇郡△△町」の郡名や、政令指定都市の市名の省略(例: '東京都瑞穂町'、'神奈川県南区')、" +
        "「ケ/ヶ/ヵ」等の異体字表記ゆれは自動的に補完を試みる。"
    ),
  chome: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "丁目番号で絞り込む(例: 2)。省略した場合、丁目ありの町については全丁目分の番地をまとめて返す。"
    ),
  limit: z.number().int().min(1).max(500).default(200),
};

async function fetchBanchi(entityPath: string, chome: number | undefined, limit: number) {
  const townIri = toIri(entityPath);

  const sparql = chome
    ? `
PREFIX ic:    <http://imi.go.jp/ns/core/rdf#>
PREFIX terms: <http://purl.org/dc/terms/>
SELECT ?banchi WHERE {
  ${townIri} terms:hasPart [ ic:丁目 ${chome}; terms:hasPart [ ic:番地 ?banchi ] ].
}
LIMIT ${limit}`.trim()
    : `
PREFIX ic:    <http://imi.go.jp/ns/core/rdf#>
PREFIX terms: <http://purl.org/dc/terms/>
SELECT ?chome ?banchi WHERE {
  { ${townIri} terms:hasPart [ ic:番地 ?banchi ]. }
  UNION
  { ${townIri} terms:hasPart [ ic:丁目 ?chome; terms:hasPart [ ic:番地 ?banchi ] ]. }
}
LIMIT ${limit}`.trim();

  const rows = await runSparql(sparql);
  return chome
    ? rows.map((row) => ({ chome, banchi: row.banchi }))
    : rows.map((row) => ({ chome: row.chome, banchi: row.banchi }));
}

export async function listBanchi({
  town,
  chome,
  limit,
}: {
  town: string;
  chome?: number;
  limit: number;
}) {
  try {
    const entityPath = normalizePath(town);
    let results = await fetchBanchi(entityPath, chome, limit);
    let note: string | undefined;

    if (results.length === 0) {
      for (const fallback of activeProfile.resolution?.fallbacks ?? []) {
        const outcome = fallback.run(entityPath, town);
        if (outcome.type === "ambiguous") {
          note =
            `"${town}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ` +
            `${outcome.labels.join("、")}。いずれかの正式名を指定して再試行すること。`;
          break;
        }
        if (outcome.type === "candidates") {
          for (const candidatePath of outcome.paths) {
            const retry = await fetchBanchi(candidatePath, chome, limit);
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

    if (!note) {
      note =
        results.length === 0
          ? "番地が見つからなかった。town が町丁目レベル(丁目番号を含まない)になっているか確認すること。"
          : "号(建物番号)はこのデータには含まれない。街区・番地レベルまでの情報。";
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(results) },
        { type: "text" as const, text: note },
      ],
    };
  } catch (error) {
    const message =
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `番地一覧の取得に失敗した: ${message}` }],
    };
  }
}

export function registerListBanchiTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.list_subparts;
  server.registerTool(
    t?.name ?? "list_banchi",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    listBanchi
  );
}
