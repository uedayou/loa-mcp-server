import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { calculateAreaKm2 } from "../geo/area.js";
import { resolveBatch } from "../core/batchPipeline.js";
import { profile as activeProfile, ctx } from "./activeProfile.js";

export const MAX_ADDRESSES = 50;

export const inputSchema = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `住所文字列またはURIの配列(最大${MAX_ADDRESSES}件、1件だけでもよい)。get_address_location と同じ表記ゆれ` +
        "(郡名・政令市名の省略、全角数字・漢数字・ハイフン区切り、「ケ/ヶ/ヵ」等の異体字)を自動補完する。" +
        "都道府県・市区町村・町丁目・丁目のいずれのレベルでも指定できる。番地レベル(ポイントのみでポリゴンを持たない住所)は" +
        "面積を算出できないため、areasから除外しunresolvedとして報告する。"
    ),
};

function roundAreaKm2(areaKm2: number): number {
  return Math.round(areaKm2 * 10_000) / 10_000; // 概ね1万m^2(0.01km^2)未満の位を丸める
}

export async function getAddressAreas({ addresses }: { addresses: string[] }) {
  const { features, unresolved, resolvedViaCompletionCount } = await resolveBatch(
    activeProfile,
    ctx,
    addresses
  );

  const areas: { query: string; name?: string; areaKm2: number }[] = [];
  const noAreaReasons: { address: string; reason: string }[] = [...unresolved];

  for (const feature of features) {
    if (!feature.geometry || feature.geometry.type === "Point") {
      noAreaReasons.push({
        address: feature.properties.query,
        reason: "番地レベル等、ポイントのみでポリゴンを持たない住所は面積を算出できない",
      });
      continue;
    }
    areas.push({
      query: feature.properties.query,
      name: feature.properties.name,
      areaKm2: roundAreaKm2(calculateAreaKm2(feature.geometry)),
    });
  }

  const notes: string[] = [];
  notes.push(
    `${addresses.length}件中${areas.length}件の面積を算出した${
      noAreaReasons.length > 0 ? `(${noAreaReasons.length}件は算出できず)` : ""
    }。`
  );
  if (resolvedViaCompletionCount > 0) {
    notes.push(`${resolvedViaCompletionCount}件は郡名/政令市名の省略・異体字表記ゆれ等を自動補完して解決した。`);
  }
  notes.push(
    "面積はGeoJSON座標(緯度経度)に対する平面近似(緯度によるcos補正込みのshoelace公式)による概算であり、" +
      "国土地理院等が公表する公式統計(測地系での厳密な計算、干潟・係争地の扱い等の実務ルールを含む)とは一致しないことがある。" +
      "MultiPolygonは離島も含めた全パーツの合計面積。"
  );

  const content = [
    { type: "text" as const, text: JSON.stringify(areas) },
    ...notes.map((text) => ({ type: "text" as const, text })),
  ];

  if (noAreaReasons.length > 0) {
    content.push({
      type: "text" as const,
      text: `面積を算出できなかった住所:\n${noAreaReasons.map((u) => `- "${u.address}": ${u.reason}`).join("\n")}`,
    });
  }

  return { isError: areas.length === 0, content };
}

export function registerGetAddressAreasTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.get_areas;
  server.registerTool(
    t?.name ?? "get_address_areas",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    getAddressAreas
  );
}
