import { LodError } from "./errors.js";
import type { EntityFormat, IdentifierStrategy, ProfileContext } from "./profile.js";

// URI 設計の差し替え(design-multi-lod-generalization.md §3.4)。
// このリポジトリの loa は "文字列をベースURLに連結" 方式なので stringConcatIdentifier
// を使う。将来 数値ID / スラッグ / コード方式のフォークが出たら別の実装を足す。

export interface StringConcatOptions {
  /** normalize 時に剥がすフォーマット拡張子。例: [".geojson", ".ttl", ...] */
  knownExtensions: string[];
  /** IRIREF に生 Unicode を埋めるか(true なら禁止文字を検知して拒否)。
   *  住所LOD の実データは生 Unicode の IRI を使うため loa は true。 */
  rawUnicodeIri: boolean;
  /** デリファレンス URL でパスを encodeURIComponent するか。 */
  fetchUrlEncoding: "encodeURIComponent" | "none";
  /** Turtle の取り方(§3.4)。"extension" = {path}.ttl / "acceptHeader" = Accept ヘッダ。 */
  dereferenceMode: "extension" | "acceptHeader";
  /** 多段パス("会社/路線/駅" のような)を許容するか。既定 true。 */
  allowPathSeparators?: boolean;
}

// IRIREF(`<...>`)内で許されない文字: ASCII 制御文字(コードポイント <= 0x20、
// スペース含む)と < > " { } | ^ \ 。旧 uri.ts の /[\x00-\x20<>"{}|^\\]/ と等価。
// 制御文字を含む正規表現リテラルをソースに置かないため、判定を関数化している。
const FORBIDDEN_IRI_SYMBOLS = '<>"{}|^\\';

function hasForbiddenIriChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) <= 0x20) return true;
    if (FORBIDDEN_IRI_SYMBOLS.includes(s[i])) return true;
  }
  return false;
}

const FORMAT_MEDIA_TYPE: Record<EntityFormat, string> = {
  ttl: "text/turtle",
  geojson: "application/geo+json",
  jsonld: "application/ld+json",
  json: "application/json",
  rdf: "application/rdf+xml",
  xml: "application/rdf+xml",
};

export function stringConcatIdentifier(opts: StringConcatOptions): IdentifierStrategy {
  return {
    normalize(input: string, ctx: ProfileContext): string {
      let path = input.trim();
      if (path.startsWith(ctx.baseUrl)) {
        path = path.slice(ctx.baseUrl.length);
      }
      for (const ext of opts.knownExtensions) {
        if (path.endsWith(ext)) {
          path = path.slice(0, -ext.length);
          break;
        }
      }
      path = path.trim();
      if (!path) {
        throw new LodError("address must not be empty");
      }
      return path;
    },

    toIri(path: string, ctx: ProfileContext): string {
      if (opts.rawUnicodeIri && hasForbiddenIriChar(path)) {
        throw new LodError(`address contains characters not allowed in an IRI: ${path}`);
      }
      return `<${ctx.baseUrl}${path}>`;
    },

    toFetchRequest(path: string, format: EntityFormat, ctx: ProfileContext) {
      const encodedPath =
        opts.fetchUrlEncoding === "encodeURIComponent" ? encodeURIComponent(path) : path;
      const url =
        opts.dereferenceMode === "extension"
          ? `${ctx.baseUrl}${encodedPath}.${format}`
          : `${ctx.baseUrl}${encodedPath}`;
      return { url, headers: { Accept: FORMAT_MEDIA_TYPE[format] } };
    },
  };
}
