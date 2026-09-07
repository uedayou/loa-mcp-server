import { DereferenceError, EntityNotFoundError } from "./errors.js";
import type { DatasetProfile, ProfileContext } from "./profile.js";
import type { EntityFeature } from "./entityFeature.js";
import { extractEntity } from "./extractEntity.js";

// 旧 src/lib/addressLod/ttl.ts の fetch 半分を profile 駆動に一般化。
// エラー文言は現行と verbatim(Tool の isError に載るため §14)。

export async function fetchTurtle(
  profile: DatasetProfile,
  ctx: ProfileContext,
  path: string
): Promise<string> {
  const { url, headers } = profile.identifier.toFetchRequest(path, "ttl", ctx);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { ...headers, "User-Agent": ctx.userAgent },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DereferenceError(`Request timed out after ${ctx.timeoutMs}ms: ${path}`);
    }
    throw new DereferenceError(`Request errored: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new EntityNotFoundError(path);
  }
  if (!response.ok) {
    throw new DereferenceError(
      `Unexpected status ${response.status} ${response.statusText}: ${path}`
    );
  }

  return response.text();
}

/** path(正規化済み)を1回だけ取得して EntityFeature にする。フォールバックは
 *  行わない(それは core/resolveEntity.ts の責務)。 */
export async function fetchEntity(
  profile: DatasetProfile,
  ctx: ProfileContext,
  path: string
): Promise<EntityFeature> {
  const turtle = await fetchTurtle(profile, ctx, path);
  return extractEntity(profile, ctx, turtle, path);
}
