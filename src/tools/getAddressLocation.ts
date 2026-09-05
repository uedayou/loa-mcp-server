import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { resolveEntityFeature } from "../core/resolveEntity.js";
import { finalizeFeature } from "../core/featureNotes.js";
import { SIMPLIFY_LEVELS, type SimplifyLevel } from "../geo/simplify.js";
import { dropSmallIslands, DEFAULT_MIN_ISLAND_AREA_KM2 } from "../geo/islandFilter.js";
import { profile as activeProfile, ctx } from "./activeProfile.js";

const inputSchema = {
  address: z
    .string()
    .describe(
      "住所文字列(例: '東京都千代田区永田町1丁目')、または住所LODのURI " +
        "(例: 'https://uedayou.net/loa/東京都千代田区永田町1丁目')。" +
        "都道府県〜丁目まではポリゴン、番地は代表点(ポイント)のみが返る。号(建物番号)は特定できない。" +
        "「〇〇郡△△町」の郡名や、政令指定都市の市名(例: '神奈川県南区'←'神奈川県横浜市南区')を省略しても自動的に補完を試みる。" +
        "「ケ/ヶ/ヵ」等の異体字表記ゆれも自動的に試行する。" +
        "複数の住所をまとめて取得したい場合は get_address_locations を使う。"
    ),
  simplify: z
    .enum(SIMPLIFY_LEVELS)
    .optional()
    .describe(
      "ポリゴンの座標点数を間引くレベル(既定 'none' = 間引かない)。必要性は住所のレベルによって大きく異なる: " +
        "丁目・丁目なし町レベル(例: 永田町1丁目、歌舞伎町)は元々数十〜100点程度しかなく、simplifyの効果はほぼないため通常は指定不要。" +
        "市区町村レベル(例: 新宿区、約1,277点)は数百〜数千点になることが多く、'low'(軽微)または'medium'(標準)を検討する価値がある。" +
        "都道府県レベル(例: 東京都、約40,428点)は数万点になり、そのままだと1回の会話で扱いきれないことがある。" +
        "'high'(積極的)は形状の崩れが大きく見た目が実用に耐えないことが多いため、" +
        "都道府県レベルなど点数が極端に多く 'low'/'medium' でも収まらない場合の最終手段として使うこと(理由なく既定選択にしない)。" +
        "Point(番地の代表点)には効果がない。"
    ),
  dropSmallIslands: z
    .boolean()
    .optional()
    .describe(
      `既定false(何も除外しない=正確な形状を保つ)。trueにすると、実面積が約${DEFAULT_MIN_ISLAND_AREA_KM2}km^2` +
        "(概ね100m四方)未満の離島(岩礁・洲を含む)をポリゴンから丸ごと除外する。" +
        "**addressが都道府県そのもの(例: '東京都'、'沖縄県'。市区町村以下は不可)である場合のみ指定できる**。" +
        "都道府県レベルは1件で数万点になり得るが、その大半は既に最小限(4点)の構成の離島パーツが占めるため、" +
        "simplifyだけでは大きく削減できない。小さい離島を除外することで大幅に削減できる" +
        "(失われる面積は都道府県の面積のごく一部)。47都道府県すべてを結合した日本地図のような用途は get_address_locations の同名パラメータを使う。"
    ),
};

export async function getAddressLocation({
  address,
  simplify,
  dropSmallIslands: shouldDropSmallIslands,
}: {
  address: string;
  simplify?: SimplifyLevel;
  dropSmallIslands?: boolean;
}) {
  const resolved = await resolveEntityFeature(activeProfile, ctx, address);

  switch (resolved.status) {
    case "resolved": {
      const allowDrop = activeProfile.geometryPolicy?.allowDropSmallIslands;
      if (shouldDropSmallIslands && allowDrop && !allowDrop(resolved.feature)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `dropSmallIslands:true は住所が都道府県そのものである場合のみ指定できるが、"${address}" は都道府県ではない。`,
            },
          ],
        };
      }

      let islandDropNote: string | undefined;
      let feature = resolved.feature;
      if (shouldDropSmallIslands && feature.geometry) {
        const result = dropSmallIslands(feature.geometry);
        feature = { ...feature, geometry: result.geometry };
        if (result.droppedCount > 0) {
          islandDropNote =
            `dropSmallIslands:true で実面積約${DEFAULT_MIN_ISLAND_AREA_KM2}km^2未満の離島を${result.droppedCount}個除外した` +
            `(失われた面積は合計約${result.droppedAreaKm2.toFixed(2)}km^2)。正確な形状が必要な場合はfalseで再取得すること。`;
        }
      }

      const { feature: finalFeature, notes } = finalizeFeature(activeProfile, feature, simplify);
      const content = [
        { type: "text" as const, text: JSON.stringify(finalFeature) },
        ...(resolved.note ? [{ type: "text" as const, text: resolved.note }] : []),
        ...(islandDropNote ? [{ type: "text" as const, text: islandDropNote }] : []),
        ...notes.map((text) => ({ type: "text" as const, text })),
      ];
      return { content };
    }
    case "ambiguous": {
      const options = resolved.candidates.join("、");
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `"${address}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ${options}。` +
              "いずれかの正式名を指定して再試行すること。",
          },
        ],
      };
    }
    case "not_found":
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `完全一致する住所が見つからなかった: "${address}"。` +
              "表記揺れ(丁目の有無・「号」を含めていないか等)の可能性がある。" +
              "search_address で候補を検索してから、そのuriを再度渡すこと。",
          },
        ],
      };
    case "error":
      return {
        isError: true,
        content: [{ type: "text" as const, text: `位置情報の取得に失敗した: ${resolved.message}` }],
      };
  }
}

export function registerGetAddressLocationTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.get_location;
  server.registerTool(
    t?.name ?? "get_address_location",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    getAddressLocation
  );
}
