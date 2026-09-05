import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatasetProfile } from "../core/profile.js";
import { renderingHintNote } from "../core/featureNotes.js";
import { type DegenerateRingStrategy } from "../geo/topologySimplify.js";
import { DEFAULT_MIN_ISLAND_AREA_KM2 } from "../geo/islandFilter.js";
import { SIMPLIFY_LEVELS, type SimplifyLevel } from "../geo/simplify.js";
import {
  applyDropAndSimplify,
  degenerateIslandsUsageError,
  dropSmallIslandsUsageError,
  resolveBatch,
  type BatchFeature,
} from "../core/batchPipeline.js";
import { profile as activeProfile, ctx } from "./activeProfile.js";

export const MAX_ADDRESSES = 50;

// Claude Desktop等の多くのMCPクライアントには、Tool呼び出し1回の結果が
// 約1MBを超えると失敗する既知の制限がある(トークン予算とは別のハード制限、
// docs/design-batch-address-locations.md §6参照)。呼び出し側(LLM)が
// dropSmallIslands/degenerateIslands/simplifyの適切な組み合わせを毎回
// 正確に指定してくれるとは限らない(実際に一部だけ守られず1MBを超過した
// 実例がある、2026-08-07)ため、Tool descriptionでの案内だけに頼らず、
// サーバー側で安全弁として自動的に最も軽量な組み合わせへ切り替える。
// この安全弁は「結果をMCPレスポンスとして返す」このTool固有の事情であり、
// ファイルへ直接書き出すsave_address_locations_to_fileには存在しない
// (レスポンスサイズの制約がそもそもないため)。
const SAFE_RESPONSE_BYTES = 950_000; // 1,000,000バイトに対して安全マージンを確保
const STRONGEST_SIMPLIFY: SimplifyLevel = "high";
const STRONGEST_DEGENERATE_ISLANDS: DegenerateRingStrategy = "omit";

export const inputSchema = {
  addresses: z
    .array(z.string())
    .min(1)
    .max(MAX_ADDRESSES)
    .describe(
      `住所文字列またはURIの配列(最大${MAX_ADDRESSES}件)。各要素は get_address_location と同じ表記ゆれ` +
        "(郡名・政令市名の省略、全角数字・漢数字・ハイフン区切り、「ケ/ヶ/ヵ」等の異体字)を自動補完する。" +
        "例: 東京都23区すべてのポリゴンをまとめて取得したい場合、まず list_child_addresses(parent:'東京都') で" +
        "23件のuriを取得し、そのままこの配列に渡す。47都道府県すべてが欲しい場合は、名前を手で列挙せず" +
        "list_prefectures の結果を使うこと(手で列挙すると書き漏らしが起きることがある)。" +
        "**ただし47都道府県すべてを結合した日本地図が欲しい場合、47件を1回で渡さないこと** — " +
        "Claude Desktop等の多くのMCPクライアントには、Tool呼び出し1回の結果が約1MBを超えると失敗する制限があり、" +
        "47都道府県一括はこのサーバーの最も軽量な組み合わせ(dropSmallIslands:true, degenerateIslands:'omit', simplify:'high')でも" +
        "1.14MBとなり必ず超過する(このケースはdropSmallIslands/degenerateIslands/simplifyをどう指定しても、" +
        "サーバー側の安全弁でも解決できないほど大きい。件数を減らす以外に方法はない)。代わりに次の5グループに分け、このToolを5回呼ぶこと" +
        "(同じ組み合わせなら各グループ1MB未満に収まる。最大の本州グループでも約930KB): " +
        "北海道=[北海道]。" +
        "本州=[青森県,岩手県,宮城県,秋田県,山形県,福島県,茨城県,栃木県,群馬県,埼玉県,千葉県,東京都,神奈川県," +
        "新潟県,富山県,石川県,福井県,山梨県,長野県,岐阜県,静岡県,愛知県,三重県,滋賀県,京都府,大阪府,兵庫県," +
        "奈良県,和歌山県,鳥取県,島根県,岡山県,広島県,山口県](34件)。" +
        "四国=[徳島県,香川県,愛媛県,高知県]。" +
        "九州=[福岡県,佐賀県,長崎県,熊本県,大分県,宮崎県,鹿児島県]。" +
        "沖縄=[沖縄県]。" +
        "これらの陸地は互いに海で隔てられているため、5分割しても通常は境界に隙間は生じない" +
        "(実測: 実際に隣接する87組中86組はグループ内に収まる)。**唯一の既知の例外は岡山県(本州)⇔香川県(四国)**" +
        "(瀬戸内海上の小島の行政界を両県が共有しているため)で、この1境界だけはズレうることを許容する。" +
        "正確な形状(離島を含む完全なポリゴン)が必要で1MB制限のあるクライアントを使わない場合は、" +
        "5分割せず47件を1回で呼んでもよい。" +
        "**この上限を超えて複数回に分けて呼ぶ場合(上記の5分割を含む)、simplifyのトポロジー共有" +
        "(隣接ポリゴンの境界線を隙間なく保つ保証)は呼び出しごとに独立してしまい、" +
        "別の呼び出しに分かれた地域同士の境界には隙間が生じ得る**(1回の呼び出し内でしか境界共有を保証できないため)。" +
        "**結果の一部(例: 1件だけ書き漏らした)を後から個別に取得して継ぎ足さないこと** — " +
        "同じ理由で、その1件だけ隣接地域との境界がズレる。不足に気づいたら、その不足分が属するグループ" +
        "(または全件)を揃え直して、そのグループ分の呼び出しを最初からやり直すこと。" +
        "**ファイルとして保存したいだけで、Claude自身がgeometryの中身を読んで地図やアプリをその場で組み立てる" +
        "必要がない場合**(例: 「GeoJSONファイルとしてエクスポートして」)は、代わりに save_address_locations_to_file を" +
        "使うと47都道府県すべてを分割せず1回でローカルファイルへ書き出せる。" +
        "**ただし「地図を作りたい/表示したい/見せてほしい」のように、Claude自身がその場でポリゴンを使って" +
        "地図(HTMLやアプリ)を組み立てる必要がある依頼では、save_address_locations_to_fileを使ってはならない** — " +
        "書き出したファイルの中身はMCPレスポンスに含まれずClaudeからは見えないため、地図を描画できなくなる。" +
        "その場合は必ずこのTool(get_address_locations)を使い、上記の5グループ分割を行うこと。"
    ),
  simplify: z
    .enum(SIMPLIFY_LEVELS)
    .optional()
    .describe(
      "ポリゴンの座標点数を間引くレベル(既定 'none')。全件をまとめてトポロジー(共有境界線)を保持したまま簡略化するため、" +
        "get_address_locationの`simplify`(各ポリゴンを独立に間引く)と異なり、隣接する地域同士の境界がズレて隙間が生じることはない。" +
        "必要性は住所のレベルによって大きく異なる: 丁目・丁目なし町レベルを複数まとめて取得する場合、1件あたり元々数十〜100点程度しかなく、" +
        "simplifyの効果はほぼないため通常は指定不要。市区町村・政令市区レベルを複数まとめて取得する場合(例: 23区すべて)は" +
        "1件あたり数百〜数千点になり得るため、まず 'low'(軽微)または 'medium'(標準)を検討する価値がある。" +
        "'high'(積極的)は小さい町ほど形状の崩れが目立ち見た目が実用に耐えないことが多いため、" +
        "'low'/'medium' でも点数が収まらない場合の最終手段として使うこと(理由なく既定選択にしない)。"
    ),
  dropSmallIslands: z
    .boolean()
    .optional()
    .describe(
      `既定false(何も除外しない=正確な形状を保つ)。trueにすると、実面積が約${DEFAULT_MIN_ISLAND_AREA_KM2}km^2` +
        "(概ね100m四方)未満の離島(岩礁・洲を含む)をポリゴンから丸ごと除外する。" +
        "**addressesの全要素が都道府県そのもの(例: '東京都'、'沖縄県'。市区町村以下は不可)である場合のみ指定できる**。" +
        "47都道府県すべてを結合した日本地図のような全国スケールの用途向け: " +
        "都道府県レベルは全国で121,834個もの離島パーツを含み、そのほとんどが既に最小限(4点)の構成のため、" +
        "simplifyによる点数の間引きだけでは大きな削減にならない(実測: 47都道府県でsimplify:'high'でも52万点超)。" +
        "小さい離島を除外することで座標点数を大幅に削減できる(実測: 上記しきい値で除外すると4万点台まで減り、" +
        "失われる面積は日本の国土面積の0.0065%のみ)。正確な形状(離島を含む完全なポリゴン)が必要な場合はfalseのまま使うこと。" +
        "**安全弁**: dropSmallIslands:trueで応答が1MB制限に近づきそうな場合、degenerateIslands/simplifyの指定によらず" +
        "サーバー側が自動的に最も軽量な組み合わせ(degenerateIslands:'omit', simplify:'high')へ切り替えて再取得する" +
        "(その旨は必ずnoteで案内される)。ただしこれは1回の呼び出しに含む件数が多すぎる場合(例: 47都道府県一括)までは救えない" +
        "ため、上記addressesの説明にある5グループ分割は引き続き必要。"
    ),
  degenerateIslands: z
    .enum(["keepOriginal", "omit"])
    .optional()
    .describe(
      "**dropSmallIslands:true かつ simplify が'none'以外である場合のみ指定できる**。" +
        "dropSmallIslandsで大きい離島だけ残した後でも、simplifyの簡略化によって形状が壊れる(退化する)離島が残ることがある。" +
        "既定'keepOriginal'は、その離島だけ簡略化前のフル精度に戻す(既存の挙動、正確だが座標点数は増える)。" +
        "'omit'は、その離島を結果から丸ごと除外することでさらに座標点数を削減する" +
        "(実測: 47都道府県+simplify:'high'で109,435点→49,554点、約55%減)。" +
        "'omit'を使う場合、dropSmallIslandsによる除外に加えてこの除外がある旨と除外数は必ずnoteとして報告される" +
        "(いずれの設定でも、地図に表示されない離島が存在することは必ずnoteで案内される)。"
    ),
};

export async function getAddressLocations({
  addresses,
  simplify,
  dropSmallIslands: shouldDropSmallIslands,
  degenerateIslands,
}: {
  addresses: string[];
  simplify?: SimplifyLevel;
  dropSmallIslands?: boolean;
  degenerateIslands?: DegenerateRingStrategy;
}) {
  const degenerateError = degenerateIslandsUsageError(
    activeProfile,
    shouldDropSmallIslands,
    simplify,
    degenerateIslands
  );
  if (degenerateError) {
    return { isError: true, content: [{ type: "text" as const, text: degenerateError }] };
  }

  const { features: resolvedFeatures, unresolved, resolvedViaCompletionCount, centroidCount } =
    await resolveBatch(activeProfile, ctx, addresses);

  const islandsError = dropSmallIslandsUsageError(activeProfile, shouldDropSmallIslands, resolvedFeatures);
  if (islandsError) {
    return { isError: true, content: [{ type: "text" as const, text: islandsError }] };
  }

  // dropSmallIslands・トポロジーsimplify・座標丸めの変換パイプライン
  // (離島の除外はsimplifyより前に行う: 除外後の残りに対して間引きを適用
  // するため。都道府県レベルのポリゴンは互いに境界を共有しないので、
  // 47都道府県を結合する用途では各都道府県の離島を個別に判定すればよく、
  // 除外がトポロジー共有を壊すことはない)。
  const pristineFeatures = resolvedFeatures.map((f) => structuredClone(f));
  let { features: transformedFeatures, islandDropNote, simplifyNote, degenerateOmitNote } = applyDropAndSimplify(
    activeProfile,
    resolvedFeatures.map((f) => structuredClone(f)),
    shouldDropSmallIslands,
    simplify,
    degenerateIslands
  );
  let escalationNote: string | undefined;

  // 安全弁: Claude Desktop等の1MB制限(このファイル冒頭のコメント参照)を
  // 超えそうな場合、要求されたパラメータの組み合わせが最も軽量なもので
  // なくても、自動的に最も軽量な組み合わせ(dropSmallIslands:true +
  // degenerateIslands:"omit" + simplify:"high")へ切り替えて再取得する。
  // dropSmallIslandsが使えない(都道府県以外を含む)バッチには適用できない。
  const responseBytes = Buffer.byteLength(JSON.stringify({ type: "FeatureCollection", features: transformedFeatures }));
  const alreadyAtStrongest =
    shouldDropSmallIslands && degenerateIslands === STRONGEST_DEGENERATE_ISLANDS && simplify === STRONGEST_SIMPLIFY;
  if (responseBytes > SAFE_RESPONSE_BYTES && shouldDropSmallIslands && !alreadyAtStrongest) {
    const escalated = applyDropAndSimplify(
      activeProfile,
      pristineFeatures.map((f) => structuredClone(f)),
      true,
      STRONGEST_SIMPLIFY,
      STRONGEST_DEGENERATE_ISLANDS
    );
    const escalatedBytes = Buffer.byteLength(JSON.stringify({ type: "FeatureCollection", features: escalated.features }));
    if (escalatedBytes < responseBytes) {
      ({ features: transformedFeatures, islandDropNote, simplifyNote, degenerateOmitNote } = escalated);
      escalationNote =
        `要求された設定では応答が約${Math.round(responseBytes / 1000).toLocaleString()}KBとなり、` +
        "多くのMCPクライアント(Claude Desktop等)の1MB制限を超える可能性が高いため、" +
        "自動的に最も軽量な組み合わせ(dropSmallIslands:true, degenerateIslands:\"omit\", simplify:\"high\")に切り替えて再取得した。" +
        "正確な形状が必要な場合は、addressesの件数を減らすか(例: 都道府県を陸地の島単位で分割する)、" +
        "1MB制限のないクライアントで元の設定のまま使うこと。";
    }
  }

  const features: BatchFeature[] = transformedFeatures;
  const featureCollection = { type: "FeatureCollection" as const, features };

  const notes: string[] = [];
  notes.push(
    `${addresses.length}件中${features.length}件を取得した${unresolved.length > 0 ? `(${unresolved.length}件は解決できず)` : ""}。`
  );
  if (resolvedViaCompletionCount > 0) {
    notes.push(
      `${resolvedViaCompletionCount}件は郡名/政令市名の省略・異体字表記ゆれ等を自動補完して解決した。`
    );
  }
  if (centroidCount > 0) {
    notes.push(
      `${centroidCount}件は住所LODに代表点(lat/long)がないため、ポリゴンの重心から算出した近似値を使用した。`
    );
  }
  if (escalationNote) {
    notes.push(escalationNote);
  }
  if (islandDropNote) {
    notes.push(islandDropNote);
  }
  if (simplifyNote) {
    notes.push(simplifyNote);
  }
  if (degenerateOmitNote) {
    notes.push(degenerateOmitNote);
  }
  if (features.some((f) => renderingHintNote(activeProfile, f))) {
    notes.push(
      "featuresの各geometryは標準的なGeoJSON。FeatureCollectionをLeafletの L.geoJSON()、MapLibre GL JS、" +
        "deck.gl等のGeoJSON対応の地図ライブラリにそのまま渡して表示できる。座標変換やSVGでの手動描画は不要。"
    );
  }

  const content = [
    { type: "text" as const, text: JSON.stringify(featureCollection) },
    ...notes.map((text) => ({ type: "text" as const, text })),
  ];

  if (unresolved.length > 0) {
    content.push({
      type: "text" as const,
      text: `解決できなかった住所:\n${unresolved.map((u) => `- "${u.address}": ${u.reason}`).join("\n")}`,
    });
  }

  return { isError: features.length === 0, content };
}

export function registerGetAddressLocationsTool(server: McpServer, profile: DatasetProfile): void {
  const t = profile.toolText.get_locations;
  server.registerTool(
    t?.name ?? "get_address_locations",
    { title: t?.title ?? "", description: t?.description ?? "", inputSchema },
    getAddressLocations
  );
}
