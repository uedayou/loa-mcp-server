// 入力正規化 + 404 後フォールバックの一般化(design-multi-lod-generalization.md §3.5)。
// loa の resolveAddress.ts「直接取得 → 郡/政令市補完 → 異体字リトライ」を
// 順序付きプラグイン列に一般化したもの。

/** 常時適用の文字列変換(曖昧性なし)。loa: 全角/漢数字/ハイフンの正規化。 */
export type InputNormalizer = (path: string) => string;

export type FallbackOutcome =
  | { type: "candidates"; paths: string[]; note: (chosen: string) => string }
  | { type: "ambiguous"; labels: string[] }
  | { type: "none" };

export interface ResolutionFallback {
  name: string;
  /** 正規化済みパスと元の入力文字列を受け取り、再試行候補 / 曖昧 / 該当なし を返す。
   *  note 文言に元の入力を含めたいフォールバック(郡補完・異体字)があるため
   *  originalInput も渡す。 */
  run(path: string, originalInput: string): FallbackOutcome;
}

/** get_location / get_locations 共通の解決結果(例外ではなくユニオン)。 */
export type ResolvedEntity =
  | { status: "resolved"; feature: import("./entityFeature.js").EntityFeature; note?: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found" }
  | { status: "error"; message: string };
