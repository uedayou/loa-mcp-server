// 移行アダプタ(design/multi-lod-generalization フェーズ2d)。実体は
// src/core/dereference.ts + src/core/extractEntity.ts。旧シグネチャ
// fetchAddressLocation(input) を保つため loa プロファイルを注入して呼ぶ。
// フェーズ3で tools が core を直接使い、このファイルを撤去する。
import { loaProfile, loaContext } from "../../profiles/loa/index.js";
import { fetchEntity } from "../../core/dereference.js";
import type { EntityFeature } from "../../core/entityFeature.js";

export type AddressFeature = EntityFeature;

export async function fetchAddressLocation(addressInput: string): Promise<AddressFeature> {
  let path = loaProfile.identifier.normalize(addressInput, loaContext);
  for (const normalize of loaProfile.resolution?.inputNormalizers ?? []) {
    path = normalize(path);
  }
  return fetchEntity(loaProfile, loaContext, path);
}
