import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSparqlQuery } from "../lib/addressLod/sparql.js";
import { normalizeToEntityPath, toFullIri } from "../lib/addressLod/uri.js";
import { completeMunicipalityOmission } from "../lib/addressLod/municipalityCompletion.js";
import { generateVariantCandidates } from "../lib/addressLod/variantCharacters.js";
import { AddressLodError } from "../lib/addressLod/errors.js";

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

async function fetchChildren(entityPath: string, limit: number) {
  const parentIri = toFullIri(entityPath);
  const sparql = `
PREFIX ic:   <http://imi.go.jp/ns/core/rdf#>
PREFIX ont:  <http://www.geonames.org/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?child ?label WHERE {
  ?child a ic:住所型; rdfs:label ?label;
         ont:parentFeature ${parentIri}.
}
LIMIT ${limit}`.trim();

  const rows = await executeSparqlQuery(sparql);
  return rows.map((row) => ({ uri: row.child, label: row.label }));
}

export async function listChildAddresses({
  parent,
  limit,
}: {
  parent: string;
  limit: number;
}) {
  try {
    const entityPath = normalizeToEntityPath(parent);
    let results = await fetchChildren(entityPath, limit);
    let note: string | undefined;

    if (results.length === 0) {
      // 「〇〇郡△△町」の郡名、または政令指定都市の市名が省略されている
      // 可能性がある。一度だけ正式名で再試行する(詳細は getAddressLocation.ts
      // と同じ理由)。
      const completion = completeMunicipalityOmission(entityPath);
      if (completion.type === "corrected") {
        results = await fetchChildren(completion.entityPath, limit);
        if (results.length > 0) {
          note = `"${parent}" は表記が省略されていたため「${completion.entityPath}」として解決した。`;
        }
      } else if (completion.type === "ambiguous") {
        note =
          `"${parent}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ` +
          `${completion.candidates.map((c) => c.label).join("、")}。いずれかの正式名を指定して再試行すること。`;
      }
    }

    if (results.length === 0) {
      // 「ケ/ヶ/ヵ」等の異体字表記ゆれの可能性がある。既知の候補を順に試す。
      for (const candidate of generateVariantCandidates(entityPath)) {
        const variantResults = await fetchChildren(candidate, limit);
        if (variantResults.length > 0) {
          results = variantResults;
          note = `"${parent}" は異体字の表記ゆれがあったため「${candidate}」として解決した。`;
          break;
        }
      }
    }

    const content = [{ type: "text" as const, text: JSON.stringify(results) }];
    if (note) content.push({ type: "text" as const, text: note });

    return { content };
  } catch (error) {
    const message =
      error instanceof AddressLodError
        ? error.message
        : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `子要素一覧の取得に失敗した: ${message}` }],
    };
  }
}

export function registerListChildAddressesTool(server: McpServer): void {
  server.registerTool(
    "list_child_addresses",
    {
      title: "住所階層の子要素一覧(ドリルダウン)",
      description:
        "指定した住所(都道府県/市区町村/町丁目)の直接の子要素一覧を取得する。" +
        "都道府県→市区町村→町丁目のドリルダウンに使う。丁目→番地の列挙はこのToolでは扱えない。" +
        "「〇〇郡△△町」の郡名、政令指定都市の市名の省略、「ケ/ヶ/ヵ」等の異体字表記ゆれは自動補完を試みる。",
      inputSchema,
    },
    listChildAddresses
  );
}
