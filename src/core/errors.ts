// 2層エラーの汎用側(design-multi-lod-generalization.md §3.10)。
//
// - 共通 Tool の catch は基底 `LodError` だけを見て、`isError: true` +
//   `error.message` を返す。プロファイルが `LodError` 派生を投げれば
//   Tool 側のコード変更なしで正しく扱われる。
// - `EntityNotFoundError` はコア型。汎用 `resolveEntity` カスケードが
//   この型で「404 → フォールバック」を分岐するため、プロファイルの
//   fallback もこの型を throw / consume する。
// - `ProfileConfigError` は `LodError` にしない。プロファイル定義の
//   不整合は起動時に fail-fast させ、Tool の isError に化けさせない。
//
// 旧 `AddressLodError` / `AddressNotFoundError` は
// `src/lib/addressLod/errors.ts` が別名として再エクスポートしている
// (移行期間中の後方互換。フェーズ3で参照を張り替えて撤去する)。

export class LodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LodError";
  }
}

/** SPARQL クエリの実行失敗・タイムアウト・非2xx応答。 */
export class SparqlError extends LodError {
  constructor(message: string) {
    super(message);
    this.name = "SparqlError";
  }
}

/** エンティティ Turtle の取得・パース失敗(404 を除く)。 */
export class DereferenceError extends LodError {
  constructor(message: string) {
    super(message);
    this.name = "DereferenceError";
  }
}

/** 404、または Turtle 内に主 subject が見つからない。resolveEntity の
 *  フォールバック(表記ゆれの再試行など)を駆動する。 */
export class EntityNotFoundError extends LodError {
  constructor(entityPath: string) {
    super(`Entity not found: ${entityPath}`);
    this.name = "EntityNotFoundError";
  }
}

/** プロファイル定義そのものの不整合(必須フィールド欠落など)。
 *  ★LodError にはしない — 起動時に落とす。 */
export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileConfigError";
  }
}
