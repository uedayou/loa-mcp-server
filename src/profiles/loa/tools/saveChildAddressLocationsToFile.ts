import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../../../core/profile.js";
import { LodError } from "../../../core/errors.js";
import { SIMPLIFY_LEVELS, type SimplifyLevel } from "../../../geo/simplify.js";
import { applyDropAndSimplify, resolveBatch } from "../../../core/batchPipeline.js";
import { profile as activeProfile, ctx } from "../context.js";
import { findChildren } from "../children.js";
import { POPULATION_REFERENCE_NOTE, withPopulationNote } from "../population.js";

// 親(例: 大阪府寝屋川市)の直下の子(町丁目)すべての位置を、1つのGeoJSON
// FeatureCollectionとしてローカルファイルへ書き出す。save_address_locations_to_file は
// addresses を最大50件の手渡しにしていたが、このToolは parent だけを受け取り、子の取得から
// 書き出しまでを内部で行うため、(1) 件数が50件を超える親でも1回で済み、(2) LLMが子の
// uri を手で列挙しなくてよい(書き漏らしが構造的に起きない)、(3) 全体を1つのトポロジーとして
// simplify できる(分割呼び出しだと境界に隙間が生じうる)。
//
// 子の件数の上限(maxChildren)は住所LOD側への負荷と応答時間のため。実測(2026-10-01):
// 約0.05秒/件(同時5件)で、子200件=約10秒、1,154件(富山県富山市)=約1分。
export const DEFAULT_MAX_CHILDREN = 1200;
export const MAX_MAX_CHILDREN = 3000;

export const inputSchema = {
  parent: z
    .string()
    .min(1)
    .describe(
      "親となる住所文字列またはURI(例: '大阪府寝屋川市'、'東京都新宿区'、'神奈川県')。" +
        "その**直下の子**(市区町村なら町丁目、都道府県なら市区町村、政令指定都市なら区)すべてが対象。" +
        "孫以下は含まれない。list_child_addresses と同じ表記ゆれ(郡名・政令市名の省略、異体字)を自動補完する。" +
        "町丁目より下(丁目・番地)は子として扱えない。"
    ),
  outputPath: z
    .string()
    .min(1)
    .describe(
      "書き出し先のファイルパス(相対パスはこのサーバープロセスのカレントディレクトリ基準、絶対パスも可)。" +
        "拡張子は呼び出し側が指定した通りに使う(GeoJSONとして扱えるよう `.geojson` を推奨)。" +
        "親ディレクトリが存在しない場合は自動的に作成する。既存ファイルがあれば上書きする。"
    ),
  simplify: z
    .enum(SIMPLIFY_LEVELS)
    .optional()
    .describe(
      "ポリゴンの座標点数を間引くレベル(既定 'none'=正確な形状のまま)。get_address_locations と同じ" +
        "トポロジー考慮型の簡略化で、子すべてを1つのトポロジーとして扱うため、隣接する町丁目同士の境界線は" +
        "共有されたまま間引かれ、隙間は生じない。ファイルサイズや後段の処理負荷を抑えたいときだけ指定する。"
    ),
  maxChildren: z
    .number()
    .int()
    .min(1)
    .max(MAX_MAX_CHILDREN)
    .optional()
    .describe(
      `子の件数の上限(既定${DEFAULT_MAX_CHILDREN}、最大${MAX_MAX_CHILDREN})。子がこれを超える親は、何も書き出さずエラーにする` +
        "(住所LOD側への負荷と応答時間のため。黙って一部だけを書き出すことはしない)。" +
        "取得時間は約0.05秒/件で、子が1,000件を超える親では1分程度かかる。" +
        "エラーになったら、より下位の親(例: 市ではなく区)に絞って呼び直すこと。"
    ),
};

export async function saveChildAddressLocationsToFile({
  parent,
  outputPath,
  simplify,
  maxChildren = DEFAULT_MAX_CHILDREN,
}: {
  parent: string;
  outputPath: string;
  simplify?: SimplifyLevel;
  maxChildren?: number;
}) {
  const startedAt = Date.now();

  // 1. 親の直下の子を全件取得(1回の SPARQL、maxChildren+1 件まで。超過は黙って切らずエラーにする)。
  let found;
  try {
    found = await findChildren(parent, maxChildren + 1);
  } catch (error) {
    const message =
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `子要素の取得に失敗した: ${message}` }],
    };
  }

  const { children, note: completionNote } = found;

  if (children.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `"${parent}" の直下の子要素が見つからなかったため、ファイルへの書き出しは行わなかった。` +
            "親が町丁目より下(丁目・番地)、または存在しない住所の可能性がある" +
            "(このToolは都道府県→市区町村(→行政区)→町丁目の階層のみ扱える)。" +
            "親自身の形だけが欲しい場合は get_address_location を使うこと。",
        },
        ...(completionNote ? [{ type: "text" as const, text: completionNote }] : []),
      ],
    };
  }

  if (children.length > maxChildren) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `"${parent}" の直下の子が maxChildren(${maxChildren}件)を超えているため、ファイルへの書き出しは行わなかった。` +
            `より下位の親(例: 市ではなく区)に絞って呼び直すか、maxChildren を増やすこと(最大${MAX_MAX_CHILDREN}件。` +
            "子が1,000件を超える場合は取得に1分程度かかる)。",
        },
      ],
    };
  }

  // ファイルの内容を呼び出しごとに再現できるよう、uri 順に固定する。
  const childUris = children.map((c) => c.uri).sort();
  // 出力は子だけで、親自身のポリゴンは含めない(親のポリゴンが子を覆うと、地図上で子を
  // クリックできなくなるため。親の形が必要なら get_address_location 等で別途取得する)。
  const addresses = childUris;

  // 2. 各要素の位置を取得(同時実行数は profile の concurrency=5)。
  const { features: resolvedFeatures, unresolved, resolvedViaCompletionCount, centroidCount } =
    await resolveBatch(activeProfile, ctx, addresses);

  if (resolvedFeatures.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `${addresses.length}件すべて解決できなかったため、ファイルへの書き出しは行わなかった。`,
        },
        {
          type: "text" as const,
          text: `解決できなかった住所:\n${unresolved.map((u) => `- "${u.address}": ${u.reason}`).join("\n")}`,
        },
      ],
    };
  }

  // 3. 全体を1つのトポロジーとして simplify(子同士の境界の隙間を防ぐ)+座標丸め。
  const { features, simplifyNote } = applyDropAndSimplify(
    activeProfile,
    resolvedFeatures,
    false,
    simplify,
    undefined
  );
  const featureCollection = { type: "FeatureCollection" as const, features };
  const text = JSON.stringify(withPopulationNote(featureCollection, features));

  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const notes: string[] = [];
  notes.push(
    `"${parent}" の直下の子${children.length}件のうち${features.length}件を ` +
      `${absolutePath} に書き出した(${Buffer.byteLength(text, "utf8").toLocaleString()}バイト、約${elapsedSec}秒)` +
      `${unresolved.length > 0 ? `。${unresolved.length}件は解決できず` : ""}。`
  );
  if (completionNote) notes.push(completionNote);
  if (resolvedViaCompletionCount > 0) {
    notes.push(`${resolvedViaCompletionCount}件は郡名/政令市名の省略・異体字表記ゆれ等を自動補完して解決した。`);
  }
  if (centroidCount > 0) {
    notes.push(
      `${centroidCount}件は住所LODに代表点(lat/long)がないため、ポリゴンの重心から算出した近似値を使用した。`
    );
  }
  if (simplifyNote) notes.push(simplifyNote);
  if (features.some((f) => typeof f.properties.population === "number")) {
    notes.push(POPULATION_REFERENCE_NOTE);
  }
  notes.push(
    "書き出したファイルは標準的なGeoJSON(RFC 7946)。QGIS等のGISソフトでそのまま開けるほか、" +
      "Leafletの L.geoJSON()、MapLibre GL JS、deck.gl等の地図ライブラリにfetch/読み込みでそのまま渡せる。"
  );

  const content = notes.map((t) => ({ type: "text" as const, text: t }));
  if (unresolved.length > 0) {
    content.push({
      type: "text" as const,
      text: `解決できなかった住所:\n${unresolved.map((u) => `- "${u.address}": ${u.reason}`).join("\n")}`,
    });
  }

  return { isError: false, content };
}

export function registerSaveChildAddressLocationsToFileTool(
  server: McpServer,
  profile: DatasetProfile
): void {
  const t = profile.toolText.save_children_to_file;
  server.registerTool(
    t?.name ?? "save_child_address_locations_to_file",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    saveChildAddressLocationsToFile
  );
}
