import { describe, expect, it } from "vitest";
import {
  normalizeFullwidthDigits,
  kanjiNumeralToArabic,
  normalizeKanjiChomeNumerals,
  normalizeHyphenatedChomeBanchi,
  normalizeAddressNumerals,
} from "../../../src/lib/addressLod/numeralNormalization.js";

describe("normalizeFullwidthDigits", () => {
  it("converts fullwidth digits to halfwidth", () => {
    expect(normalizeFullwidthDigits("永田町１丁目")).toBe("永田町1丁目");
    expect(normalizeFullwidthDigits("１２３")).toBe("123");
  });

  it("leaves halfwidth digits and non-digit text untouched", () => {
    expect(normalizeFullwidthDigits("永田町1丁目")).toBe("永田町1丁目");
  });
});

describe("kanjiNumeralToArabic", () => {
  it.each([
    ["一", 1],
    ["九", 9],
    ["十", 10],
    ["十一", 11],
    ["十九", 19],
    ["二十", 20],
    ["二十一", 21],
    ["九十九", 99],
    ["百", 100],
    ["三百二十五", 325],
  ])("converts %s to %d", (kanji, expected) => {
    expect(kanjiNumeralToArabic(kanji)).toBe(expected);
  });

  it("returns null for non-numeral or mixed text", () => {
    expect(kanjiNumeralToArabic("永田町")).toBeNull();
    expect(kanjiNumeralToArabic("")).toBeNull();
    expect(kanjiNumeralToArabic("1")).toBeNull();
  });
});

describe("normalizeKanjiChomeNumerals", () => {
  it("converts a kanji chome number to arabic", () => {
    expect(normalizeKanjiChomeNumerals("東京都千代田区永田町一丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
    expect(normalizeKanjiChomeNumerals("六本木六丁目")).toBe("六本木6丁目");
  });

  it("leaves text without 丁目 untouched", () => {
    expect(normalizeKanjiChomeNumerals("東京都西多摩郡瑞穂町")).toBe("東京都西多摩郡瑞穂町");
  });
});

describe("normalizeHyphenatedChomeBanchi", () => {
  it("converts trailing chome-banchi shorthand", () => {
    expect(normalizeHyphenatedChomeBanchi("東京都千代田区永田町1-7")).toBe(
      "東京都千代田区永田町1丁目7"
    );
  });

  it("drops a trailing 号 segment (chome-banchi-go)", () => {
    expect(normalizeHyphenatedChomeBanchi("東京都千代田区永田町1-7-1")).toBe(
      "東京都千代田区永田町1丁目7"
    );
  });

  it("leaves text without the trailing pattern untouched", () => {
    expect(normalizeHyphenatedChomeBanchi("東京都千代田区永田町1丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
  });
});

describe("normalizeAddressNumerals (combined)", () => {
  it("handles all three forms end to end (実データ検証済み: 東京都千代田区永田町1丁目7)", () => {
    expect(normalizeAddressNumerals("東京都千代田区永田町１丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
    expect(normalizeAddressNumerals("東京都千代田区永田町一丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
    expect(normalizeAddressNumerals("東京都千代田区永田町1-7")).toBe(
      "東京都千代田区永田町1丁目7"
    );
    expect(normalizeAddressNumerals("東京都千代田区永田町1-7-1")).toBe(
      "東京都千代田区永田町1丁目7"
    );
  });

  it("is a no-op for an already-canonical path", () => {
    expect(normalizeAddressNumerals("東京都千代田区永田町1丁目7")).toBe(
      "東京都千代田区永田町1丁目7"
    );
  });
});
