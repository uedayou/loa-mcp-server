import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_MIN_ISLAND_AREA_KM2 } from "../lib/addressLod/islandFilter.js";
import { SIMPLIFY_LEVELS, type SimplifyLevel } from "../lib/addressLod/simplify.js";
import type { DegenerateRingStrategy } from "../lib/addressLod/topologySimplify.js";
import {
  applyDropAndSimplify,
  degenerateIslandsUsageError,
  dropSmallIslandsUsageError,
  resolveBatch,
} from "../lib/addressLod/batchAddressPipeline.js";

// get_address_locationsと違い、結果をMCPレスポンスに載せずローカルファイルへ
// 直接書き出すため、多くのMCPクライアントが持つTool呼び出し1回あたり約1MBの
// レスポンス上限(docs/design-batch-address-locations.md §6)を構造的に
// 回避できる。get_address_locationsのMAX_ADDRESSES(50件、47都道府県が
// 収まる上限)をそのまま流用しているのは、住所LOD側への配慮(同時実行数の
// 抑制)が目的であり、レスポンスサイズの制約ではない。
export const MAX_ADDRESSES = 50;

export const inputSchema = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `住所文字列またはURIの配列(最大${MAX_ADDRESSES}件)。get_address_locations と同じ表記ゆれ` +
        "(郡名・政令市名の省略、全角数字・漢数字・ハイフン区切り、「ケ/ヶ/ヵ」等の異体字)を自動補完する。" +
        "47都道府県すべてをファイルへエクスポートする場合は、名前を手で列挙せず list_prefectures の結果を使うこと" +
        "(手で列挙すると書き漏らしが起きることがある)。このToolは結果をファイルに書き出すため、" +
        "get_address_locationsと違って1MB制限を避けるために件数を分ける必要はない" +
        "(ただしファイルに保存したいだけの場合に限る。地図・アプリをその場で作る依頼にはこのTool自体を使わないこと。titleの注意参照)。"
    ),
  simplify: z
    .enum(SIMPLIFY_LEVELS)
    .optional()
    .describe(
      "ポリゴンの座標点数を間引くレベル(既定 'none')。get_address_locationsと同じトポロジー考慮型の簡略化" +
        "(全件のうち隣接する地域同士の境界線を共有した状態のまま間引くため、境界のズレは生じない)。" +
        "ファイルに書き出すためMCPレスポンスのサイズ制限はないが、ファイルサイズや後段で読み込むツール側の" +
        "負荷を抑えたい場合は指定するとよい。"
    ),
  dropSmallIslands: z
    .boolean()
    .optional()
    .describe(
      `既定false(何も除外しない=正確な形状を保つ)。trueにすると、実面積が約${DEFAULT_MIN_ISLAND_AREA_KM2}km^2` +
        "(概ね100m四方)未満の離島(岩礁・洲を含む)をポリゴンから丸ごと除外する。" +
        "**addressesの全要素が都道府県そのもの(例: '東京都'、'沖縄県'。市区町村以下は不可)である場合のみ指定できる**。" +
        "このToolはMCPレスポンスのサイズ制限を受けないため、47都道府県すべてを結合したファイルが欲しいだけなら" +
        "指定不要(falseのまま正確な形状で書き出せる)。ファイルサイズ自体を抑えたい場合のみ指定すること。"
    ),
  degenerateIslands: z
    .enum(["keepOriginal", "omit"])
    .optional()
    .describe(
      "**dropSmallIslands:true かつ simplify が'none'以外である場合のみ指定できる**。" +
        "get_address_locationsと同じ意味(既定'keepOriginal'は退化した離島をフル精度に戻す、" +
        "'omit'はその離島を結果から丸ごと除外してさらに軽量化する)。"
    ),
  outputPath: z
    .string()
    .min(1)
    .describe(
      "書き出し先のファイルパス(相対パスはこのサーバープロセスのカレントディレクトリ基準、絶対パスも可)。" +
        "拡張子は呼び出し側が指定した通りに使う(GeoJSONとして扱えるよう `.geojson` を推奨)。" +
        "親ディレクトリが存在しない場合は自動的に作成する。既存ファイルがあれば上書きする。"
    ),
};

export async function saveAddressLocationsToFile({
  addresses,
  simplify,
  dropSmallIslands: shouldDropSmallIslands,
  degenerateIslands,
  outputPath,
}: {
  addresses: string[];
  simplify?: SimplifyLevel;
  dropSmallIslands?: boolean;
  degenerateIslands?: DegenerateRingStrategy;
  outputPath: string;
}) {
  const degenerateError = degenerateIslandsUsageError(shouldDropSmallIslands, simplify, degenerateIslands);
  if (degenerateError) {
    return { isError: true, content: [{ type: "text" as const, text: degenerateError }] };
  }

  const { features: resolvedFeatures, unresolved, resolvedViaCompletionCount, centroidCount } =
    await resolveBatch(addresses);

  const islandsError = dropSmallIslandsUsageError(shouldDropSmallIslands, resolvedFeatures);
  if (islandsError) {
    return { isError: true, content: [{ type: "text" as const, text: islandsError }] };
  }

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

  const { features, islandDropNote, simplifyNote, degenerateOmitNote } = applyDropAndSimplify(
    resolvedFeatures,
    shouldDropSmallIslands,
    simplify,
    degenerateIslands
  );
  const featureCollection = { type: "FeatureCollection" as const, features };
  const text = JSON.stringify(featureCollection);

  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");

  const notes: string[] = [];
  notes.push(
    `${addresses.length}件中${features.length}件を ${absolutePath} に書き出した` +
      `(${Buffer.byteLength(text, "utf8").toLocaleString()}バイト)${unresolved.length > 0 ? `。${unresolved.length}件は解決できず` : ""}。`
  );
  if (resolvedViaCompletionCount > 0) {
    notes.push(`${resolvedViaCompletionCount}件は郡名/政令市名の省略・異体字表記ゆれ等を自動補完して解決した。`);
  }
  if (centroidCount > 0) {
    notes.push(
      `${centroidCount}件は住所LODに代表点(lat/long)がないため、ポリゴンの重心から算出した近似値を使用した。`
    );
  }
  if (islandDropNote) notes.push(islandDropNote);
  if (simplifyNote) notes.push(simplifyNote);
  if (degenerateOmitNote) notes.push(degenerateOmitNote);
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

export function registerSaveAddressLocationsToFileTool(server: McpServer): void {
  server.registerTool(
    "save_address_locations_to_file",
    {
      title: "複数住所の位置をファイルへエクスポート保存(地図・アプリをその場で作る用途には使わない)",
      description:
        "**「地図を作りたい/表示したい/見せてほしい」等、Claude自身が取得したポリゴンを使ってその場で" +
        "地図・可視化・アプリを組み立てる依頼には、このToolを使ってはならない** — 書き出したファイルの中身は" +
        "MCPレスポンスに含まれずClaudeからは見えないため、地図を描画できなくなる。そのような依頼では" +
        "必ず get_address_locations を使うこと(47都道府県なら5グループに分割する)。" +
        "このToolを使ってよいのは、ユーザーが明示的にファイルへの保存・エクスポートだけを求めている場合" +
        "(例: 「GeoJSONファイルとして保存して」「〇〇のデータをエクスポートして」、Claude自身が中身を読む必要がない場合)に限る。" +
        "get_address_locations と同じく複数の住所をまとめて取得するが、結果をMCPレスポンスに含めず" +
        "1つのGeoJSON FeatureCollectionとしてローカルファイルへ直接書き出し、パスと概要だけを返す。" +
        "Claude Desktop等の多くのMCPクライアントが持つTool呼び出し1回あたり約1MBのレスポンス上限を" +
        "構造的に回避できるため、大きいバッチ(例: 47都道府県すべての結合データ)でも" +
        "get_address_locationsのように5グループに分割せず1回の呼び出しで(正確な形状のまま)ファイルに書き出せる。" +
        "このToolはローカルのファイルシステムに書き込む点に注意。",
      inputSchema,
    },
    saveAddressLocationsToFile
  );
}
