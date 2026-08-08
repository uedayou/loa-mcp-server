// Normalizes common ways Japanese addresses write chome/banchi numbers so
// they match the plain-ASCII-digit form 住所LOD's entity paths use (verified
// live: "東京都千代田区永田町１丁目" / "…一丁目" / "…1-7" all 404, only
// "…1丁目7" resolves). This is a pure string transform — unlike the
// county/designated-city completion in municipalityCompletion.ts, there's no
// ambiguity to resolve, so it's applied unconditionally as normalization
// rather than as a retry-after-404 fallback.

const FULLWIDTH_DIGIT_RE = /[０-９]/g;

export function normalizeFullwidthDigits(text: string): string {
  return text.replace(FULLWIDTH_DIGIT_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const KANJI_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const KANJI_NUMERAL_CHARS = new Set([
  ...Object.keys(KANJI_DIGITS),
  ...Object.keys(KANJI_UNITS),
]);

// Converts a Japanese numeral string ("十二" -> 12, "二十一" -> 21) using the
// standard positional construction. Returns null for anything containing a
// character outside the kanji-numeral set.
export function kanjiNumeralToArabic(text: string): number | null {
  if (!text || [...text].some((ch) => !KANJI_NUMERAL_CHARS.has(ch))) return null;

  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch];
    } else {
      const unit = KANJI_UNITS[ch];
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
    }
  }
  return total + current;
}

const KANJI_CHOME_RE = /([〇一二三四五六七八九十百千]+)丁目/g;

// "永田町一丁目" -> "永田町1丁目"
export function normalizeKanjiChomeNumerals(text: string): string {
  return text.replace(KANJI_CHOME_RE, (match, kanji: string) => {
    const value = kanjiNumeralToArabic(kanji);
    return value === null ? match : `${value}丁目`;
  });
}

// Trailing "1-7" / "1-7-1" shorthand (chome-banchi(-go)) -> "1丁目7".
// 号(building number) has no equivalent in 住所LOD, so a third segment is
// dropped. Only matches at the very end of the string, after some non-empty
// prefix — place names in this dataset never contain a literal digit-hyphen
// sequence, so this is unambiguous.
const HYPHENATED_CHOME_BANCHI_RE = /^(.+?)(\d+)-(\d+)(?:-\d+)?$/;

export function normalizeHyphenatedChomeBanchi(text: string): string {
  const match = text.match(HYPHENATED_CHOME_BANCHI_RE);
  if (!match) return text;
  const [, prefix, chome, banchi] = match;
  return `${prefix}${chome}丁目${banchi}`;
}

export function normalizeAddressNumerals(text: string): string {
  let result = normalizeFullwidthDigits(text);
  result = normalizeKanjiChomeNumerals(result);
  result = normalizeHyphenatedChomeBanchi(result);
  return result;
}
