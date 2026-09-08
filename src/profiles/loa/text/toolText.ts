import type { ToolKey, ToolText } from "../../../core/profile.js";

// 各 Tool の LLM 向けメタ情報(name / title / description)。
// 現行の profiles/loa/tools/*.ts の registerTool 第2引数から verbatim に移植。
// Tool 固有の集計注記(notes フィールド)はフェーズ3で共通 Tool を profile 駆動に
// するときに埋める。list_prefectures は staticLists.ts 側。
//
// get_address_locations / save_address_locations_to_file の説明にあった
// `${MAX_ADDRESSES}` は 50。
export const LOA_TOOL_TEXT: Partial<Record<ToolKey, ToolText>> = {
  search: {
    name: "search_address",
    title: "住所を検索",
    description:
      "住所LODを使って、住所ラベルの部分一致で候補を検索する。" +
      "「ケ/ヶ/ヵ」等の異体字表記ゆれは自動的に吸収する。" +
      "形状(ポリゴン/ポイント)が必要な場合は、結果のURIを get_address_location に渡すこと。",
  },

  get_location: {
    name: "get_address_location",
    title: "住所の位置(ポリゴン/ポイント)を取得",
    description:
      "住所LODから、指定した住所のポリゴンまたはポイントをGeoJSON Featureとして取得する。" +
      "住所LODの `.ttl`(Turtle)を取得し、クライアント側(このサーバー)でGeoJSONに変換する " +
      "(住所LOD側のサーバー負荷軽減のため、`.geojson`ではなく`.ttl`を使う)。" +
      "「〇〇郡△△町」の郡名、政令指定都市の市名の省略、「ケ/ヶ/ヵ」等の異体字表記ゆれは自動補完を試みる。" +
      "`simplify` でポリゴンの座標点数を間引ける(市区町村レベル以上は数千点になることがあり、必要精度が低い用途では指定を推奨)。" +
      "都道府県・市区町村・一部の町丁目レベルは住所LODが代表点(lat/long)を持たないため、その場合はポリゴンの重心" +
      "(MultiPolygonは最大面積のポリゴンの重心)で自動的に補完する(`properties.point_source: 'centroid'`で判別可能)。" +
      "戻り値のgeometryは標準的なGeoJSON(RFC 7946)。地図に表示する場合はLeafletの`L.geoJSON()`やMapLibre GL JS、" +
      "deck.gl等のGeoJSON対応の地図ライブラリにそのまま渡せばよく、座標変換やSVGでの手動描画を自前で行う必要はない。" +
      "複数の住所(例: 23区すべて)をまとめて取得したい場合は、1件ずつこのToolを呼ぶ代わりに get_address_locations を使う。" +
      "`dropSmallIslands`(都道府県のみ指定可)で、点数の大半を占める極小の離島を除外して大幅に軽量化できる。",
  },

  get_locations: {
    name: "get_address_locations",
    title:
      "複数住所の位置(ポリゴン/ポイント)をまとめて取得(地図・アプリをその場で作る場合は必ずこちら)",
    description:
      "複数の住所をまとめて取得し、1つのGeoJSON FeatureCollectionとして返す。" +
      "get_address_location を住所ごとに何度も呼ぶ代わりに使う(例: 「23区すべて」のような複数エンティティをまとめて地図表示したい場合)。最大50件まで。" +
      "各要素の解決ルール(郡名・政令市名の省略補完、数字表記・異体字の正規化、代表点がない場合のポリゴン重心補完)は get_address_location と共通。" +
      "`simplify`は全Featureをまとめてトポロジー(共有境界線)を保持したまま簡略化するため、get_address_locationと違って隣接する地域間に隙間が生じない。" +
      "一部の住所が解決できなくても全体を失敗にはせず、featuresから除外した上でunresolvedとして注記する(全件失敗のときのみisError)。" +
      "戻り値のFeatureCollectionは標準的なGeoJSON(RFC 7946)なので、Leaflet等の地図ライブラリにそのまま渡せる(座標変換・SVGでの手動描画は不要)。" +
      "`dropSmallIslands`(都道府県のみ指定可)を使うと、47都道府県すべてを結合した日本地図のような全国スケールの用途でも扱えるサイズまで縮小できる。" +
      "`degenerateIslands`(dropSmallIslands:trueかつsimplify指定時のみ)でさらに軽量化できるが、いずれの設定でも地図に表示されない離島があることは必ずnoteで案内される。" +
      "**地図を作りたい/表示したい/見せてほしい、のようにClaude自身が取得したポリゴンを使ってその場で地図やアプリを組み立てる依頼では、必ずこのTool(get_address_locations)を使うこと** — " +
      "save_address_locations_to_fileはファイルに書き出すだけで中身がレスポンスに含まれないため、地図を描画できない。" +
      "結果をそのまま会話に返す必要がなく、ファイルとして保存したいだけの場合(例: 「GeoJSONとしてエクスポートして」)にのみ save_address_locations_to_file を使うこと。",
  },

  list_child: {
    name: "list_child_addresses",
    title: "住所階層の子要素一覧(ドリルダウン)",
    description:
      "指定した住所(都道府県/市区町村/町丁目)の直接の子要素一覧を取得する。" +
      "都道府県→市区町村→町丁目のドリルダウンに使う。丁目→番地の列挙はこのToolでは扱えない。" +
      "「〇〇郡△△町」の郡名、政令指定都市の市名の省略、「ケ/ヶ/ヵ」等の異体字表記ゆれは自動補完を試みる。",
  },

  list_subparts: {
    name: "list_banchi",
    title: "町丁目配下の番地一覧",
    description:
      "指定した町丁目に属する番地を列挙する。丁目のある町は丁目ごとの番地、丁目のない町はそのまま番地一覧になる。" +
      "号(建物番号)は元データに含まれないため取得できない。" +
      "「〇〇郡△△町」の郡名、政令指定都市の市名の省略、「ケ/ヶ/ヵ」等の異体字表記ゆれは自動補完を試みる。",
  },

  geohash_nearby: {
    name: "reverse_geocode_address",
    title: "緯度経度から近傍住所を検索(逆ジオコーディング)",
    description:
      "緯度経度から近傍の町丁目レベルの住所候補を検索する。精度上限は町丁目レベル(SPARQL上に丁目・番地のgeohashが" +
      "存在しないため)。都道府県境界付近などでは候補が漏れる可能性がある近似検索であり、点在ジオコーディング(点→行政区画の" +
      "厳密な判定)ではない。",
  },

  save_to_file: {
    name: "save_address_locations_to_file",
    title:
      "複数住所の位置をファイルへエクスポート保存(地図・アプリをその場で作る用途には使わない)",
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
  },

  get_areas: {
    name: "get_address_areas",
    title: "住所(都道府県・市区町村・町丁目)の面積を算出",
    description:
      "1件以上の住所の面積(km^2)をまとめて算出して返す。都道府県・市区町村・町丁目・丁目のいずれのレベルでも使えるが、" +
      "都道府県・主要市区町村レベルの面積は公表された統計値がよく知られているため、このToolの価値は相対的に低い。" +
      "**むしろ町丁目・丁目レベルのような、公表資料に載っていない細かい単位の面積や、" +
      "複数件を横断した合計・比較(例: 「23区のうち面積10km^2以上の区は?」)でこそ真価を発揮する** — " +
      "そうした値は住所LODのポリゴンから算出する以外に入手手段がないため。" +
      "面積は緯度経度座標に対する平面近似(cos補正付きshoelace公式)による概算値であり、" +
      "国土地理院等の公式統計とは一致しないことがある点に注意(戻り値の注記にも毎回明記される)。" +
      "番地レベル(ポイントのみ)は面積を算出できないため対象外。" +
      "各要素の解決ルール(郡名・政令市名の省略補完、数字表記・異体字の正規化)は get_address_location と共通。",
  },
};
