import { EntityNotFoundError, LodError } from "./errors.js";
import type { DatasetProfile, ProfileContext } from "./profile.js";
import type { ResolvedEntity } from "./resolutionTypes.js";
import { fetchEntity } from "./dereference.js";

// 旧 src/lib/addressLod/resolveAddress.ts の resolveAddressFeature を profile 駆動に一般化。
// 挙動は loa プロファイルで従来と等価:
//   normalize(strip) → inputNormalizers → 直接取得
//   → 404 なら fallbacks を順に(candidates を試す / ambiguous で確定 / none で次へ)
//   → 全滅で not_found、その他のエラーは error。
export async function resolveEntityFeature(
  profile: DatasetProfile,
  ctx: ProfileContext,
  input: string
): Promise<ResolvedEntity> {
  const rawPath = profile.identifier.normalize(input, ctx);
  let path = rawPath;
  for (const normalize of profile.resolution?.inputNormalizers ?? []) {
    path = normalize(path);
  }

  const toError = (error: unknown): ResolvedEntity => {
    const message =
      error instanceof LodError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return { status: "error", message };
  };

  try {
    const feature = await fetchEntity(profile, ctx, path);
    return { status: "resolved", feature };
  } catch (error) {
    if (!(error instanceof EntityNotFoundError)) return toError(error);

    // 正規化(数字表記の書き換え等)で表記が変わっていて404になった場合は、書き換える前の
    // 表記でも試す。実在する名前そのものに漢数字等が含まれることがあるため
    // (実データ: 富山県富山市水橋花の井町(一丁目) — 正規化すると「(1丁目)」になり存在しない)。
    // 追加のリクエストは「正規化で表記が変わった入力が404になったとき」だけ。
    if (path !== rawPath) {
      try {
        const feature = await fetchEntity(profile, ctx, rawPath);
        return { status: "resolved", feature };
      } catch (rawError) {
        if (!(rawError instanceof EntityNotFoundError)) return toError(rawError);
      }
    }

    for (const fallback of profile.resolution?.fallbacks ?? []) {
      const outcome = fallback.run(path, input);
      if (outcome.type === "ambiguous") {
        return { status: "ambiguous", candidates: outcome.labels };
      }
      if (outcome.type === "candidates") {
        for (const candidatePath of outcome.paths) {
          try {
            const feature = await fetchEntity(profile, ctx, candidatePath);
            return { status: "resolved", feature, note: outcome.note(candidatePath) };
          } catch {
            // 次の候補、なければ次の fallback へ。
          }
        }
      }
      // "none" もここへ来て次の fallback。
    }

    return { status: "not_found" };
  }
}
