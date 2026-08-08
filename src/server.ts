import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

// クライアント(Claude Desktop等)の初期化時に一度だけ提示される、サーバー
// 全体についてのガイダンス。個々のToolのdescriptionは「どのToolを検討するか
// 決めた後」にしか読まれないため、「日本地図を作りたい」のような依頼で
// LLMがTool一覧を検討する前にWeb検索へ流れてしまう場合の誘導には効かない
// (実際にClaude Desktopで発生した事例、2026-08-07)。
//
// 最初のバージョン(Web検索を避けるよう促すだけの文言)を試したところ、
// 今度はLLMが「地図を作りたい」を一般的な創作タスクとして扱い、用途を
// 確認する選択肢(統計地図/白地図画像/複数ファイルの結合)を提示した上、
// ユーザーが選んでもなお「アップロードされたファイルを結合する」という
// 誤った前提(実際にはアップロードは一切発生していない)で処理しようとした
// 事例が実機で確認された。これを受けて、(1)ファイルのアップロードは一切
// 不要でこのサーバーが直接データを取得すること、(2)この種の依頼では
// 用途を確認する選択肢を提示せず、まずToolを呼んで結果を提示すること、
// の2点を明示的に指示する文言に強化した。
const INSTRUCTIONS =
  "日本の住所・行政区域(都道府県・市区町村・町丁目・番地)の検索、位置情報(ポリゴン/ポイント)が必要なときは、" +
  "必ずこのサーバーのToolを使うこと。Web検索で既存のGeoJSONファイルや地図画像を探したり、" +
  "ユーザーにファイルのアップロードを求めたりしないこと — このサーバーが住所LOD(https://uedayou.net/loa/、" +
  "オープンライセンス)から直接データを取得するため、ユーザー側のファイルは一切不要。" +
  "「日本地図を作りたい」「都道府県ごとに色分けした地図」「白地図画像/SVGが欲しい」" +
  "「都道府県境界を結合したGeoJSON」「23区の地図を表示したい」「〇〇市の形を見せて」等、" +
  "最終成果物の形(統計地図・画像・生データのいずれでも)によらず、" +
  "**都道府県・市区町村等の境界データ自体は必ずこのサーバーのToolで取得すること**。" +
  "境界データ取得後の扱いは目的に応じて異なる: 色分け統計地図なら境界に統計データ(このサーバーは持たない)を重ねて可視化する、" +
  "画像/SVGが欲しいなら取得したGeoJSONをそのままLeaflet等の地図ライブラリ・SVGで描画する(座標変換やゼロからの手動作図は不要)、" +
  "結合データが欲しいならget_address_locationsの結果をそのまま返す。" +
  "いずれの場合も、用途を確認する選択肢を提示する前に、まずこのサーバーのToolを呼んで境界データを取得すること。" +
  "47都道府県すべてを結合した日本地図が欲しい場合は、47都道府県の名称(一般知識で把握できる、" +
  "list_child_addresses等での事前確認は不要)を get_address_locations の addresses に渡し、" +
  "dropSmallIslands:true を指定して1回で取得する(都道府県レベルの住所にのみ指定可、詳細はTool descriptionを参照)。";

// システム上の技術的な識別子(package.json / .mcp.json のキー等)は
// "loa-mcp-server" で統一する。`title`はMCPプロトコル上、`name`とは別に
// 用意されている「人間向けの表示名」フィールドで、ユーザーがプロンプトで
// 「住所LOD MCPサーバーを使って」と呼びかけたときの手がかりになることを狙い、
// ここに日本語の名称を設定する(`instructions`と違い、`title`は基本的な
// 表示用フィールドのためクライアントに広く読まれる可能性が高いが、
// LLMのTool選択判断に確実に効くとまでは実機検証していない、2026-08-08)。
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: config.serverName,
      version: config.serverVersion,
      title: "住所LOD MCPサーバー",
      description:
        "日本の住所を検索し、位置(ポリゴン/ポイント)を住所LOD(https://uedayou.net/loa/)から取得するMCPサーバー。",
    },
    { instructions: INSTRUCTIONS }
  );

  registerAllTools(server);
  registerAllResources(server);

  return server;
}
