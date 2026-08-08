import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSparqlQuery } from "../lib/addressLod/sparql.js";
import { normalizeToEntityPath, toFullIri } from "../lib/addressLod/uri.js";
import { completeMunicipalityOmission } from "../lib/addressLod/municipalityCompletion.js";
import { generateVariantCandidates } from "../lib/addressLod/variantCharacters.js";
import { AddressLodError } from "../lib/addressLod/errors.js";

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
  const townIri = toFullIri(entityPath);

  // 丁目を持つ町の番地は「町 --hasPart--> 丁目 --hasPart--> 番地」という
  // 2段ネストでしか辿れない(丁目エンティティに直接hasPartしても取れない
  // ことを実機確認済み)。丁目を持たない町は「町 --hasPart--> 番地」の1段。
  // chome が指定されていなければ両方を UNION で拾い、呼び出し側が
  // 事前にどちらの構造か知らなくても使えるようにする。
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

  const rows = await executeSparqlQuery(sparql);
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
    const entityPath = normalizeToEntityPath(town);
    let results = await fetchBanchi(entityPath, chome, limit);
    let note: string | undefined;

    if (results.length === 0) {
      // 「〇〇郡△△町」の郡名、または政令指定都市の市名が省略されている
      // 可能性がある。一度だけ正式名で再試行する(詳細は getAddressLocation.ts
      // と同じ理由)。
      const completion = completeMunicipalityOmission(entityPath);
      if (completion.type === "corrected") {
        results = await fetchBanchi(completion.entityPath, chome, limit);
        if (results.length > 0) {
          note = `"${town}" は表記が省略されていたため「${completion.entityPath}」として解決した。`;
        }
      } else if (completion.type === "ambiguous") {
        note =
          `"${town}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ` +
          `${completion.candidates.map((c) => c.label).join("、")}。いずれかの正式名を指定して再試行すること。`;
      }
    }

    if (results.length === 0) {
      // 「ケ/ヶ/ヵ」等の異体字表記ゆれの可能性がある。既知の候補を順に試す。
      for (const candidate of generateVariantCandidates(entityPath)) {
        const variantResults = await fetchBanchi(candidate, chome, limit);
        if (variantResults.length > 0) {
          results = variantResults;
          note = `"${town}" は異体字の表記ゆれがあったため「${candidate}」として解決した。`;
          break;
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
      error instanceof AddressLodError
        ? error.message
        : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `番地一覧の取得に失敗した: ${message}` }],
    };
  }
}

export function registerListBanchiTool(server: McpServer): void {
  server.registerTool(
    "list_banchi",
    {
      title: "町丁目配下の番地一覧",
      description:
        "指定した町丁目に属する番地を列挙する。丁目のある町は丁目ごとの番地、丁目のない町はそのまま番地一覧になる。" +
        "号(建物番号)は元データに含まれないため取得できない。" +
        "「〇〇郡△△町」の郡名、政令指定都市の市名の省略、「ケ/ヶ/ヵ」等の異体字表記ゆれは自動補完を試みる。",
      inputSchema,
    },
    listBanchi
  );
}
