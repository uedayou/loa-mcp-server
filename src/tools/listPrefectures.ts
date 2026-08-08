import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PREFECTURES } from "../lib/addressLod/prefectures.js";

// パラメータなし。47都道府県は静的な不変データ(prefectures.ts)なので、
// 住所LODへの問い合わせは不要。
const inputSchema = {};

// 47都道府県を日本地図として結合取得したいとき、LLMが自分の記憶から名前を
// 手で列挙すると書き漏らしが起きうる(実際に「滋賀県」が抜けたまま
// get_address_locationsに渡され、後から1件だけ個別に取得・継ぎ足すことに
// なり、その1件だけ境界がズレる実例があった、2026-08-07)。このToolで
// 正式な47件をまとめて取得すれば、その種の書き漏らし自体を防げる。
export async function listPrefectures() {
  const content = [{ type: "text" as const, text: JSON.stringify(PREFECTURES) }];
  return { content };
}

export function registerListPrefecturesTool(server: McpServer): void {
  server.registerTool(
    "list_prefectures",
    {
      title: "47都道府県の名称一覧を取得",
      description:
        "日本の47都道府県の正式名称を配列で返す(パラメータなし)。" +
        "47都道府県すべてを結合した日本地図をget_address_locationsで作りたい場合、" +
        "addressesにこのToolの結果をそのまま渡すこと。LLM自身の記憶から47件を手で列挙すると" +
        "書き漏らしが起きることがあり、後から不足分だけ個別に取得して結果に継ぎ足すと、" +
        "その1件だけ隣接する都道府県との境界がズレる(simplifyのトポロジー共有は" +
        "1回の呼び出し内でしか保証されないため)。このToolで正式な一覧を取得すればその心配がない。",
      inputSchema,
    },
    listPrefectures
  );
}
