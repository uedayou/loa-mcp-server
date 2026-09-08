import { config, userAgent } from "../../config.js";
import type { DatasetProfile, ProfileContext } from "../../core/profile.js";
import { LOA_VOCAB } from "./vocab.js";
import { loaIdentifier } from "./identifier.js";
import { LOA_INSTRUCTIONS } from "./instructions.js";
import { LOA_NOTES } from "./text/notes.js";
import { LOA_TOOL_TEXT } from "./text/toolText.js";
import { LOA_STATIC_LISTS } from "./staticLists.js";
import { loaInputNormalizers, loaFallbacks } from "./resolution/index.js";
import { loaNarrowScope } from "./geohashCache.js";
import { isPrefectureName } from "./resolution/prefectures.js";

// 住所LOD プロファイル。server.ts が import する唯一のプロファイル。
// フォークはこのディレクトリを丸ごと差し替え、server.ts の import 行を書き換える。
export const loaProfile: DatasetProfile = {
  id: "loa",

  server: {
    name: config.serverName, // 技術識別子。既定 "loa-mcp-server"(env で上書き可)
    title: "住所LOD MCPサーバー",
    description:
      "日本の住所を検索し、位置(ポリゴン/ポイント)を住所LOD(https://uedayou.net/loa/)から取得するMCPサーバー。",
    instructions: LOA_INSTRUCTIONS,
  },

  endpoints: {
    baseUrl: "https://uedayou.net/loa/",
    sparqlEndpoint: "https://uedayou.net/loa/sparql/query",
    timeoutMs: 10000,
    sparqlTimeoutMs: 15000,
    sparqlHttpMethod: "auto",
    sparqlPostContentType: "application/x-www-form-urlencoded",
    concurrency: 5, // 住所LOD側への配慮のため全件同時に投げない
  },

  vocab: LOA_VOCAB,

  identifier: loaIdentifier,

  capabilities: {
    search: true,
    dereferenceGeometry: true,
    hierarchy: true,
    subParts: true,
    geohashNearby: true,
    batch: true,
    area: true,
  },

  resolution: {
    inputNormalizers: loaInputNormalizers,
    fallbacks: loaFallbacks,
  },

  staticLists: LOA_STATIC_LISTS,

  // Tool 実装は profiles/loa/tools/ にあり、profiles/loa/registerTools.ts が
  // フラットに登録する(design-tools-layer-generalization.md §3)。

  geohashNearby: {
    narrowScope: loaNarrowScope,
    defaultMode: "prefix",
  },

  geometryPolicy: {
    // dropSmallIslands は addresses の全要素が都道府県そのもののときだけ許可。
    allowDropSmallIslands: (feature) => isPrefectureName(feature.properties.name as string | undefined),
  },

  attribution: "住所LOD (https://uedayou.net/loa/) CC BY 4.0",

  notes: LOA_NOTES,

  toolText: LOA_TOOL_TEXT,
};

// 実行時コンテキスト。endpoints は env(ADDRESS_LOD_*)で上書きされた
// config.addressLod の解決済み値を使う(design §5.2)。
export const loaContext: ProfileContext = {
  baseUrl: config.addressLod.baseUrl,
  sparqlEndpoint: config.addressLod.sparqlEndpoint,
  userAgent,
  timeoutMs: config.addressLod.timeoutMs,
  sparqlTimeoutMs: config.addressLod.sparqlTimeoutMs,
  sparqlHttpMethod: loaProfile.endpoints.sparqlHttpMethod ?? "auto",
  sparqlPostContentType:
    loaProfile.endpoints.sparqlPostContentType ?? "application/x-www-form-urlencoded",
  concurrency: loaProfile.endpoints.concurrency ?? 5,
};
