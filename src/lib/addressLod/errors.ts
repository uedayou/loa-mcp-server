// 移行シム(design/multi-lod-generalization フェーズ2)。
// 実体は src/core/errors.ts。旧名 AddressLodError / AddressNotFoundError は
// フェーズ3で全参照を LodError / EntityNotFoundError に張り替えてから撤去する。
export * from "../../core/errors.js";
import { LodError, EntityNotFoundError } from "../../core/errors.js";

/** @deprecated LodError を使うこと(src/core/errors.ts)。 */
export { LodError as AddressLodError };
/** @deprecated EntityNotFoundError を使うこと(src/core/errors.ts)。 */
export { EntityNotFoundError as AddressNotFoundError };
