// Known equivalence classes of characters that Japanese place names use
// interchangeably in casual writing, even though 住所LOD picks one
// canonical form per place. Verified live: 東京都西多摩郡瑞穂町's official
// "箱根ケ崎" (regular-size katakana ケ, U+30B1) 404s when written
// "箱根ヶ崎" (small-form ヶ, U+30F6) — different Unicode codepoints, and
// search_address's CONTAINS doesn't bridge them either since it's a literal
// substring match.
//
// Intentionally small and only populated with classes verified against real
// 住所LOD data; extend it if another variant is found to cause real lookup
// failures.
export const VARIANT_CLASSES: readonly string[][] = [
  ["ケ", "ヶ", "ヵ"], // e.g. 箱根ケ崎/箱根ヶ崎, 関ケ原/関ヶ原
];

export function findVariantClass(ch: string): string[] | undefined {
  return VARIANT_CLASSES.find((cls) => cls.includes(ch));
}

export function hasVariantCharacter(text: string): boolean {
  return [...text].some((ch) => findVariantClass(ch) !== undefined);
}

const REGEX_METACHARS = /[.*+?()[\]{}|^$\\]/;

function escapeRegexChar(ch: string): string {
  return REGEX_METACHARS.test(ch) ? `\\${ch}` : ch;
}

// Builds a SPARQL REGEX()-compatible pattern that matches `text` but treats
// any known variant-character class as interchangeable (e.g. "箱根ケ崎" ->
// "箱根[ケヶヵ]崎"). Characters outside any known class that happen to be
// regex metacharacters are escaped so they still match literally — SPARQL's
// REGEX() uses XPath/XQuery regex syntax, and address text should never
// need to use its special characters semantically. The resulting string is
// still a raw regex pattern; embed it in a SPARQL query via
// escapeSparqlLiteral() same as any other string literal (that layer is
// independent of, and applied on top of, this one).
export function buildVariantAwareRegexPattern(text: string): string {
  let pattern = "";
  for (const ch of text) {
    const cls = findVariantClass(ch);
    pattern += cls ? `[${cls.join("")}]` : escapeRegexChar(ch);
  }
  return pattern;
}

// Generates alternate spellings of `text` by substituting known
// interchangeable characters, for retrying a failed direct URI lookup.
// Never includes `text` itself. Bounded to avoid combinatorial blowup —
// real place names have at most one or two such characters, so the cap is
// generous headroom, not a practical constraint.
export function generateVariantCandidates(text: string, maxCandidates = 8): string[] {
  const positions: { index: number; alternatives: string[] }[] = [];
  for (let i = 0; i < text.length; i++) {
    const cls = findVariantClass(text[i]);
    if (cls) {
      const alternatives = cls.filter((c) => c !== text[i]);
      if (alternatives.length > 0) positions.push({ index: i, alternatives });
    }
  }
  if (positions.length === 0) return [];

  let candidates = [text];
  for (const pos of positions) {
    const next: string[] = [];
    for (const candidate of candidates) {
      next.push(candidate);
      for (const alt of pos.alternatives) {
        next.push(candidate.slice(0, pos.index) + alt + candidate.slice(pos.index + 1));
      }
      if (next.length > maxCandidates * 4) break; // safety valve
    }
    candidates = next;
  }

  return [...new Set(candidates)].filter((c) => c !== text).slice(0, maxCandidates);
}
