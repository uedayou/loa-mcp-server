import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { profile as activeProfile } from "./activeProfile.js";

// キュレーション済みの静的リストを Tool として登録する(profile.staticLists 駆動)。
// loa では list_prefectures 1件のみ。パラメータなし・ネットワークアクセスなし。

// 後方互換: 従来の listPrefectures ハンドラ(引数なしで有効プロファイルの
// 最初の静的リストを返す)。テストが直接呼ぶ。
export async function listPrefectures() {
  const list = activeProfile.staticLists?.[0];
  const items = list ? await list.items() : [];
  return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
}

export function registerListPrefecturesTool(server: McpServer, profile: DatasetProfile): void {
  for (const list of profile.staticLists ?? []) {
    server.registerTool(
      list.toolKey,
      { title: list.title, description: list.description, inputSchema: {} },
      async () => {
        const items = await list.items();
        return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
      }
    );
  }
}
