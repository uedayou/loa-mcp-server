import { config } from "../../config.js";
import { AddressLodError } from "./errors.js";
import { normalizeAddressNumerals } from "./numeralNormalization.js";

const KNOWN_EXTENSIONS = [".geojson", ".jsonld", ".json", ".ttl", ".xml"];

// Accepts either a bare notation string ("東京都千代田区永田町1丁目"), a full
// entity URL, or a formatted URL (.geojson/.ttl/...), and normalizes all of
// them to the bare entity path used to build fetch URLs and IRIs.
export function normalizeToEntityPath(address: string): string {
  let path = address.trim();
  if (path.startsWith(config.addressLod.baseUrl)) {
    path = path.slice(config.addressLod.baseUrl.length);
  }
  for (const ext of KNOWN_EXTENSIONS) {
    if (path.endsWith(ext)) {
      path = path.slice(0, -ext.length);
      break;
    }
  }
  path = path.trim();
  if (!path) {
    throw new AddressLodError("address must not be empty");
  }
  // 全角数字・漢数字・ハイフン区切り(1-7-1等)を住所LODが使う半角数字表記に
  // 正規化する。曖昧性のない純粋な文字列変換なので、郡/政令市補完のような
  // 再試行ではなく常に適用する(詳細は numeralNormalization.ts)。
  return normalizeAddressNumerals(path);
}

// Characters forbidden inside a Turtle/SPARQL IRIREF (`<...>`): ASCII control
// characters, space, and `<`, `>`, `"`, `{`, `}`, `|`, `^`, `\`.
// eslint-disable-next-line no-control-regex
const IRIREF_FORBIDDEN = /[\x00-\x20<>"{}|^\\]/;

// Builds a full IRI reference (e.g. "<https://uedayou.net/loa/東京都新宿区>")
// for embedding in SPARQL. The entity path is embedded as raw Unicode text,
// NOT percent-encoded — the actual data in the store uses raw Unicode IRIs
// (verified against production: a percent-encoded IRI matches zero triples),
// so percent-encoding here would silently break every query. Injection is
// instead prevented by rejecting the handful of characters the IRIREF
// grammar itself forbids unescaped — genuine Japanese address text never
// contains any of them.
export function toFullIri(entityPath: string): string {
  if (IRIREF_FORBIDDEN.test(entityPath)) {
    throw new AddressLodError(`address contains characters not allowed in an IRI: ${entityPath}`);
  }
  return `<${config.addressLod.baseUrl}${entityPath}>`;
}

// Escapes a value for embedding inside a SPARQL string literal ("...").
export function escapeSparqlLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
