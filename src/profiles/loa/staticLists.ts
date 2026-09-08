import type { StaticListDef } from "../../core/profile.js";
import { PREFECTURES } from "./resolution/prefectures.js";

// list_prefectures: 47都道府県の正式名称一覧。住所LOD への問い合わせなし。
// 現行 profiles/loa/tools/listPrefectures.ts の title/description を verbatim に移植。
export const LOA_STATIC_LISTS: StaticListDef[] = [
  {
    toolKey: "list_prefectures",
    title: "47都道府県の名称一覧を取得",
    description:
      "日本の47都道府県の正式名称を配列で返す(パラメータなし)。" +
      "47都道府県すべてを結合した日本地図をget_address_locationsで作りたい場合、" +
      "addressesにこのToolの結果をそのまま渡すこと。LLM自身の記憶から47件を手で列挙すると" +
      "書き漏らしが起きることがあり、後から不足分だけ個別に取得して結果に継ぎ足すと、" +
      "その1件だけ隣接する都道府県との境界がズレる(simplifyのトポロジー共有は" +
      "1回の呼び出し内でしか保証されないため)。このToolで正式な一覧を取得すればその心配がない。",
    items: () => [...PREFECTURES],
  },
];
