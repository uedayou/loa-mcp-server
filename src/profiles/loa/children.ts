import { profile as activeProfile, runSparql, normalizePath, toIri } from "./context.js";
import { LOAP_JINKO, LOAP_SETAI } from "./vocab.js";

// list_child_addresses と save_child_address_locations_to_file が共有する、
// 「親の直下の子要素を SPARQL で取得する」処理(郡名・政令市名の省略補完フォールバック込み)。

export type SortBy = "none" | "population" | "households";

export interface ChildAddress {
  uri: string;
  label: string;
  population?: number;
  households?: number;
}

export function childrenQuery(parentPath: string, limit: number, sortBy: SortBy): string {
  const v = activeProfile.vocab;
  const parentIri = toIri(parentPath);
  // 実測(2026-09-30): 住所LODの SPARQL エンドポイントでは「型制約(a ic:住所型)+ORDER BY」の
  // 組み合わせだけが約1.3秒かかり(親の子要素数によらず一定)、型制約を外すと約20ms(60倍速)。
  // ont:parentFeature の子は全て住所エンティティなので、型制約の有無で結果集合は変わらない
  // (神奈川県/東京都/北海道/政令市/町丁目など8親で完全一致を確認)。並べ替え時のみ外す。
  const typeConstraint =
    v.entityTypeIri && sortBy === "none" ? `a <${v.entityTypeIri}>; ` : "";
  const hierarchyClause = v.childToParentIri
    ? `?child ${typeConstraint}<${v.labelIri}> ?label; <${v.childToParentIri}> ${parentIri}.`
    : `${parentIri} <${v.parentToChildIri}> ?child. ?child <${v.labelIri}> ?label.`;
  // 人口・世帯数は SPARQL エンドポイントの独自語彙 loap:。丁目・番地には付かないため OPTIONAL。
  const optionals =
    `\n  OPTIONAL { ?child <${LOAP_JINKO}> ?population }` +
    `\n  OPTIONAL { ?child <${LOAP_SETAI}> ?households }`;
  // DESC 並べ替えでは未バインド(人口データなし)は SPARQL 仕様上自動的に末尾になる。
  const orderBy = sortBy === "none" ? "" : `\nORDER BY DESC(?${sortBy})`;
  return `SELECT ?child ?label ?population ?households WHERE {\n  ${hierarchyClause}${optionals}\n}${orderBy}\nLIMIT ${limit}`;
}

async function fetchChildren(
  parentPath: string,
  limit: number,
  sortBy: SortBy
): Promise<ChildAddress[]> {
  const rows = await runSparql(childrenQuery(parentPath, limit, sortBy));
  return rows.map((row) => {
    const child: ChildAddress = { uri: row.child, label: row.label };
    if (row.population !== undefined) child.population = Number(row.population);
    if (row.households !== undefined) child.households = Number(row.households);
    return child;
  });
}

export interface FoundChildren {
  children: ChildAddress[];
  /** 郡名・政令市名の補完をしたとき、または補完が曖昧で決められなかったときの説明。 */
  note?: string;
}

/**
 * 親(住所文字列またはURI)の直下の子を取得する。SPARQL は dereference と別実装
 * (簡略化グラフ)のため resolveEntity は使えない。0件のときは同じ
 * profile.resolution.fallbacks で候補を生成し、SPARQL を再試行する。
 * 通信エラー等は呼び出し側へ throw する(LodError)。
 */
export async function findChildren(
  parent: string,
  limit: number,
  sortBy: SortBy = "none"
): Promise<FoundChildren> {
  const entityPath = normalizePath(parent);
  let children = await fetchChildren(entityPath, limit, sortBy);
  let note: string | undefined;

  if (children.length === 0) {
    for (const fallback of activeProfile.resolution?.fallbacks ?? []) {
      const outcome = fallback.run(entityPath, parent);
      if (outcome.type === "ambiguous") {
        // Tool 固有の言い回し(実務的 B-mid: インライン既定)。
        note =
          `"${parent}" は郡名または政令市名を省略した表記だが、同名の地名が複数存在するため一意に決められない: ` +
          `${outcome.labels.join("、")}。いずれかの正式名を指定して再試行すること。`;
        break;
      }
      if (outcome.type === "candidates") {
        for (const candidatePath of outcome.paths) {
          const retry = await fetchChildren(candidatePath, limit, sortBy);
          if (retry.length > 0) {
            children = retry;
            note = outcome.note(candidatePath);
            break;
          }
        }
        if (children.length > 0) break;
      }
    }
  }

  return { children, note };
}
