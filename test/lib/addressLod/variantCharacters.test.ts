import { describe, expect, it } from "vitest";
import {
  hasVariantCharacter,
  buildVariantAwareRegexPattern,
  generateVariantCandidates,
} from "../../../src/lib/addressLod/variantCharacters.js";

describe("hasVariantCharacter", () => {
  it("detects a known variant character", () => {
    expect(hasVariantCharacter("箱根ヶ崎")).toBe(true);
    expect(hasVariantCharacter("箱根ケ崎")).toBe(true);
  });

  it("returns false for text without any known variant", () => {
    expect(hasVariantCharacter("永田町")).toBe(false);
  });
});

describe("buildVariantAwareRegexPattern", () => {
  it("expands a known variant character into a bracket class (実データ: 箱根ケ崎)", () => {
    expect(buildVariantAwareRegexPattern("箱根ケ崎")).toBe("箱根[ケヶヵ]崎");
  });

  it("escapes regex metacharacters that aren't part of a variant class", () => {
    expect(buildVariantAwareRegexPattern("a.b")).toBe("a\\.b");
    expect(buildVariantAwareRegexPattern("a(b)")).toBe("a\\(b\\)");
  });

  it("leaves ordinary text unchanged", () => {
    expect(buildVariantAwareRegexPattern("永田町")).toBe("永田町");
  });
});

describe("generateVariantCandidates", () => {
  it("generates the other spellings for a single variant character (実データ: 箱根ケ崎)", () => {
    const candidates = generateVariantCandidates("箱根ケ崎");
    expect(candidates.sort()).toEqual(["箱根ヵ崎", "箱根ヶ崎"].sort());
  });

  it("does not include the original text", () => {
    expect(generateVariantCandidates("箱根ケ崎")).not.toContain("箱根ケ崎");
  });

  it("returns an empty array when there's nothing to vary", () => {
    expect(generateVariantCandidates("永田町")).toEqual([]);
  });

  it("handles two variant characters by generating all combinations, capped", () => {
    const candidates = generateVariantCandidates("ケヶ");
    // 3x3 = 9 combinations minus the original = 8, within the default cap of 8.
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates).toContain("ケケ");
    expect(candidates).toContain("ヵヵ");
  });
});
