import { describe, expect, it } from "vitest";
import {
  findDesignatedCityWardCandidates,
  completeDesignatedCityWard,
} from "../../../src/profiles/loa/resolution/designatedCityWardIndex.js";

describe("findDesignatedCityWardCandidates", () => {
  it("finds the designated city for a bare ward name (実データ: 南区 -> 複数候補)", () => {
    const candidates = findDesignatedCityWardCandidates("南区");
    expect(candidates.length).toBeGreaterThanOrEqual(10); // 南区 exists in many cities nationwide
    expect(candidates).toContainEqual({
      prefecture: "神奈川県",
      city: "横浜市",
      ward: "南区",
      municipality: "横浜市南区",
      uri: "https://uedayou.net/loa/神奈川県横浜市南区",
      label: "神奈川県横浜市南区",
    });
  });

  it("does not narrow to a single match when the prefecture itself has two designated cities sharing a ward name (実データ: 神奈川県南区 -> 横浜市 and 相模原市)", () => {
    const scoped = findDesignatedCityWardCandidates("南区", "神奈川県");
    expect(scoped.length).toBe(2);
    expect(scoped.map((c) => c.city).sort()).toEqual(["横浜市", "相模原市"]);
  });

  it("narrows to a single match for a ward name unique within its prefecture (実データ: 中央区 -> 相模原市)", () => {
    const scoped = findDesignatedCityWardCandidates("中央区", "神奈川県");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].city).toBe("相模原市");
  });
});

describe("completeDesignatedCityWard", () => {
  it("corrects a bare ward-level path (実データ: 東京都ではなく神奈川県中央区 -> 神奈川県相模原市中央区)", () => {
    const result = completeDesignatedCityWard("神奈川県中央区");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("神奈川県相模原市中央区");
  });

  it("corrects a path that goes deeper than the ward (a town within it)", () => {
    const result = completeDesignatedCityWard("神奈川県中央区みどりが丘");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("神奈川県相模原市中央区みどりが丘");
  });

  it("reports ambiguity when even the prefecture doesn't disambiguate (実データ: 神奈川県南区)", () => {
    const result = completeDesignatedCityWard("神奈川県南区");
    expect(result.type).toBe("ambiguous");
    if (result.type !== "ambiguous") throw new Error("unreachable");
    expect(result.candidates.map((c) => c.city).sort()).toEqual(["横浜市", "相模原市"]);
  });

  it("returns none when the ward name has no match", () => {
    expect(completeDesignatedCityWard("東京都そんざいしないく").type).toBe("none");
  });

  it("returns none when the path is already correct", () => {
    expect(completeDesignatedCityWard("神奈川県横浜市南区").type).toBe("none");
  });
});
