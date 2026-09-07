import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EntityFeature } from "./entityFeature.js";
import type { InputNormalizer, ResolutionFallback } from "./resolutionTypes.js";

// サイト固有の情報をすべて閉じ込めるオブジェクト(design-multi-lod-generalization.md §3)。
// core / geo / 共通 tools はこの型だけを見て動く。このリポジトリのプロファイルは
// loa 1つだけで、server.ts が loaProfile を直接ワイヤリングする(選択機構は作らない)。
// フォーク側は profiles/<自サイト>/ を書き、server.ts の import を差し替える。

// ---- 補助型 ---------------------------------------------------------------

/** propertyMap の1エントリ: エンティティのトリプルからの読み取り方。 */
export type PropertyBinding =
  | { predicate: string } // 直接(単値)
  | { predicate: string; multi: true } // 多値 → 配列
  | { predicate: string; via: string } // blank node 経由(住所コード → 識別値)
  | { predicate: string; transform: (raw: string) => string | number };

/** subject ごとにまとめたトリプルの索引(customExtract に渡す)。 */
export type QuadIndex = Map<string, { predicate: string; object: { value: string } }[]>;

export interface ProfileContext {
  readonly baseUrl: string;
  readonly sparqlEndpoint: string;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly sparqlTimeoutMs: number;
  readonly sparqlHttpMethod: "GET" | "POST" | "auto";
  readonly sparqlPostContentType: "application/x-www-form-urlencoded" | "application/sparql-query";
  readonly concurrency: number;
}

export type EntityFormat = "ttl" | "geojson" | "jsonld" | "json" | "rdf" | "xml";

export interface IdentifierStrategy {
  /** ユーザー入力(ラベル文字列 / 完全URL / 拡張子付きURL)→ 素のエンティティパス。 */
  normalize(input: string, ctx: ProfileContext): string;
  /** エンティティパス → SPARQL 埋め込み用の完全 IRI("<...>")。 */
  toIri(path: string, ctx: ProfileContext): string;
  /** エンティティパス → デリファレンス用のリクエスト。dereferenceMode により
   *  拡張子付きURL か 拡張子なしURL + Accept ヘッダ かが決まる(§3.4)。 */
  toFetchRequest(
    path: string,
    format: EntityFormat,
    ctx: ProfileContext
  ): { url: string; headers: Record<string, string> };
}

export interface StaticListDef {
  toolKey: string; // 例: "list_prefectures"
  title: string;
  description: string;
  items: () => string[] | Promise<string[]>;
}

export interface DissolveGuardOptions {
  /** この総点数を超える MultiPolygon では共有辺の事前チェックすらスキップする。 */
  maxPointsForSharedEdgeCheck?: number;
}

export interface GeometryPolicy {
  /** dropSmallIslands を許可する対象か(loa: 都道府県レベルのみ)。 */
  allowDropSmallIslands?(feature: EntityFeature): boolean;
  dissolveGuard?: DissolveGuardOptions;
}

export type ToolKey =
  | "search"
  | "get_location"
  | "get_locations"
  | "list_child"
  | "list_subparts"
  | "geohash_nearby"
  | "save_to_file"
  | "get_areas";

export type ToolNoteTemplate =
  | string
  | ((...args: readonly (string | number | readonly string[])[]) => string);

export interface ToolText {
  name: string; // "search_address" / "search_placename" など
  title: string;
  description: string;
  paramDescriptions?: Record<string, string>; // zod .describe() の上書き
  /** その Tool 固有の集計・要約注記の文言(モデルB-mid、§0)。
   *  フェーズ3で共通 Tool を profile 駆動にするときに埋める。
   *  各 Tool が自分の使う名前で参照する(例: profile.toolText.get_areas.notes.disclaimer)。 */
  notes?: Record<string, ToolNoteTemplate>;
}

// 共有機構(core/featureNotes.ts / core/batchPipeline.ts / core/resolveEntity.ts)が
// 出す横断的な注記の文言(design §0 モデルB-mid)。core/ は「どの注記を出すか」だけを
// 判断し、文言は全てここから取る。loa は profiles/loa/text/notes.ts で現行文字列を
// verbatim に実装する。Tool 固有の集計注記は ToolText.notes 側(per-tool)。
export interface ProfileNotes {
  /** 代表点(lat/long)がポリゴン重心からの補完値のとき。 */
  centroidPoint: string;
  /** geometry が Polygon/MultiPolygon のとき毎回(地図ライブラリへの受け渡し誘導)。 */
  renderingHint: string;
  /** RDP simplify 適用時(get_location)。 */
  simplifyApplied(level: string, before: number, after: number): string;
  /** トポロジー考慮 simplify 適用時(get_locations / save_to_file)。 */
  simplifyAppliedTopology(level: string, before: number, after: number): string;
  /** dropSmallIslands 適用時。 */
  islandsDropped(count: number, lostAreaKm2: number, thresholdKm2: number): string;
  /** degenerateIslands:"omit" 適用時。 */
  degenerateIslandsOmitted(count: number, level: string): string;
  /** バッチで完全一致が見つからなかった要素の理由。 */
  unresolvedNotFound: string;
  /** バッチで同名地名が複数あり一意に決められなかった要素の理由。 */
  unresolvedAmbiguous(candidates: string[]): string;
  /** degenerateIslands パラメータの誤用エラー文言。 */
  errDegenerateIslandsUsage: string;
  /** dropSmallIslands パラメータの誤用エラー文言。 */
  errDropSmallIslandsUsage(nonPrefectureQueries: string[]): string;
}

export type ToolRegistrar = (server: McpServer, profile: DatasetProfile) => void;

// ---- 本体 ---------------------------------------------------------------

export interface DatasetProfile {
  /** 安定した識別子。profiles/<id>/・test/profiles/<id>/・起動ログに使う。 */
  id: string;

  server: {
    name: string;
    title: string;
    description: string;
    instructions: string;
  };

  endpoints: {
    baseUrl: string;
    sparqlEndpoint: string;
    timeoutMs: number;
    sparqlTimeoutMs: number;
    sparqlHttpMethod?: "GET" | "POST" | "auto"; // 既定 "auto"
    sparqlPostContentType?: "application/x-www-form-urlencoded" | "application/sparql-query";
    concurrency?: number; // 既定 5
  };

  vocab: {
    /** デリファレンスした Turtle から主 subject を切り分ける方法(§3.7)。 */
    subjectSelector:
      | { by: "rdfType"; typeIri: string }
      | { by: "requestedIri" }
      | { by: "mostTriples" };
    /** SPARQL 側の型制約に使う IRI。型トリプルを持たないデータセットでは省略。 */
    entityTypeIri?: string;

    labelIri: string;
    labelLang: string | null;
    /** 多言語ラベルで SELECT 行が重複するサーバー向け。loa: false。 */
    filterLabelLang?: boolean;
    altLabelIri?: string;

    /** 階層(少なくとも一方向あれば hierarchy 成立、§3.1 / §6)。 */
    childToParentIri?: string;
    parentToChildIri?: string;
    /** 部分要素の2段ネスト列挙(loa の list_banchi 相当)。 */
    subPartNesting?: { outerIri: string; innerIri: string };

    geometry: {
      wktIri: string;
      latIri: string;
      longIri: string;
      geohashIri?: string;
      geohashPrecision?: { min: number; max: number; default: number };
    };

    propertyMap: Record<string, PropertyBinding>;
  };

  /** propertyMap で表せない構造化・多値プロパティの抽出フック(§3.7)。 */
  customExtract?: (quadsBySubject: QuadIndex, subjectIri: string) => Record<string, unknown>;

  identifier: IdentifierStrategy;

  capabilities: {
    search: boolean;
    dereferenceGeometry: boolean;
    hierarchy: boolean;
    subParts: boolean;
    geohashNearby: boolean;
    batch: boolean;
    area: boolean;
  };

  resolution?: {
    inputNormalizers: InputNormalizer[];
    fallbacks: ResolutionFallback[];
  };

  staticLists?: StaticListDef[];

  /** プロファイル所有 Tool(§3.12)。汎用化しない Tool を自前登録する。 */
  ownedTools?: {
    search?: ToolRegistrar;
    geohashNearby?: ToolRegistrar;
    extra?: ToolRegistrar[];
  };

  /** geohash 近傍検索の絞り込みフック(§3.11)。loa: 都道府県 geohash キャッシュ。 */
  geohashNearby?: {
    narrowScope?: (
      inputGeohash: string
    ) => Promise<{ predicate: string; value: string } | null>;
    defaultMode?: "prefix" | "exact";
  };

  geometryPolicy?: GeometryPolicy;

  /** 出典・ライセンス表記。save_to_file の出力ヘッダ・注記に使える。 */
  attribution?: string;

  /** 実行時のユーザー向け注記・メッセージ文言(モデルB、§0)。 */
  notes: ProfileNotes;

  toolText: Partial<Record<ToolKey, ToolText>>;
}
