import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../../../core/profile.js";
import { calculateAreaKm2 } from "../../../geo/area.js";
import { resolveBatch } from "../../../core/batchPipeline.js";
import { profile as activeProfile, ctx } from "../context.js";
import { POPULATION_REFERENCE_NOTE } from "../population.js";
import { AREA_APPROXIMATION_NOTE } from "./getAddressAreas.js";

export const MAX_ADDRESSES = 50;

export const inputSchema = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `住所文字列またはURIの配列(最大${MAX_ADDRESSES}件、1件だけでもよい)。get_address_location と同じ表記ゆれ` +
        "(郡名・政令市名の省略、全角数字・漢数字・ハイフン区切り、「ケ/ヶ/ヵ」等の異体字)を自動補完する。" +
        "都道府県・市区町村・行政区・町丁目・丁目のいずれのレベルでも指定できる。" +
        "番地レベル(ポイントのみ)と、人口データを持たない住所は除外し理由付きで報告する。"
    ),
};

interface PopulationRow {
  query: string;
  name?: string;
  population: number;
  households?: number;
  areaKm2?: number;
  densityPerKm2?: number;
}

function roundTo(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export async function getAddressPopulations({ addresses }: { addresses: string[] }) {
  const { features, unresolved, resolvedViaCompletionCount } = await resolveBatch(
    activeProfile,
    ctx,
    addresses
  );

  const rows: PopulationRow[] = [];
  const excluded: { address: string; reason: string }[] = [...unresolved];

  for (const feature of features) {
    const { population, households, name, query } = feature.properties;
    if (typeof population !== "number") {
      excluded.push({
        address: query,
        reason: feature.geometry?.type === "Point"
          ? "番地レベルには人口・世帯数が付与されていない"
          : "住所LODにこの住所の人口・世帯数データがない(国勢調査に対応データがない地域等)",
      });
      continue;
    }

    const row: PopulationRow = { query, name, population };
    if (typeof households === "number") row.households = households;

    if (feature.geometry && feature.geometry.type !== "Point") {
      const areaKm2 = calculateAreaKm2(feature.geometry);
      row.areaKm2 = roundTo(areaKm2, 4);
      if (areaKm2 > 0) row.densityPerKm2 = roundTo(population / areaKm2, 1);
    }
    rows.push(row);
  }

  const notes: string[] = [];
  notes.push(
    `${addresses.length}件中${rows.length}件の人口・世帯数を取得した${
      excluded.length > 0 ? `(${excluded.length}件は取得できず)` : ""
    }。`
  );
  if (resolvedViaCompletionCount > 0) {
    notes.push(`${resolvedViaCompletionCount}件は郡名/政令市名の省略・異体字表記ゆれ等を自動補完して解決した。`);
  }
  notes.push(POPULATION_REFERENCE_NOTE);
  if (rows.some((r) => r.areaKm2 !== undefined)) {
    notes.push(`densityPerKm2は人口÷areaKm2。${AREA_APPROXIMATION_NOTE}`);
  }

  const content = [
    { type: "text" as const, text: JSON.stringify(rows) },
    ...notes.map((text) => ({ type: "text" as const, text })),
  ];

  if (excluded.length > 0) {
    content.push({
      type: "text" as const,
      text: `人口・世帯数を取得できなかった住所:\n${excluded.map((u) => `- "${u.address}": ${u.reason}`).join("\n")}`,
    });
  }

  return { isError: rows.length === 0, content };
}

export function registerGetAddressPopulationsTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.get_populations;
  server.registerTool(
    t?.name ?? "get_address_populations",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    getAddressPopulations
  );
}
