// 移行アダプタ(フェーズ2d)。実体は src/core/resolveEntity.ts。
// 旧シグネチャ resolveAddressFeature(address) を保つため loa プロファイルを注入。
import { loaProfile, loaContext } from "../../profiles/loa/index.js";
import { resolveEntityFeature } from "../../core/resolveEntity.js";
import type { ResolvedEntity } from "../../core/resolutionTypes.js";

export type ResolvedAddress = ResolvedEntity;

export function resolveAddressFeature(address: string): Promise<ResolvedAddress> {
  return resolveEntityFeature(loaProfile, loaContext, address);
}
