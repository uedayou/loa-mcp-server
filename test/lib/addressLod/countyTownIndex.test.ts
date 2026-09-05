import { describe, expect, it } from "vitest";
import {
  findCountyTownCandidates,
  completeCountyTown,
} from "../../../src/profiles/loa/resolution/countyTownIndex.js";

describe("findCountyTownCandidates", () => {
  it("finds the county for a bare town name (実データ: 瑞穂町 -> 西多摩郡瑞穂町)", () => {
    const candidates = findCountyTownCandidates("瑞穂町");
    expect(candidates).toContainEqual({
      prefecture: "東京都",
      county: "西多摩郡",
      municipality: "西多摩郡瑞穂町",
      uri: "https://uedayou.net/loa/東京都西多摩郡瑞穂町",
      label: "東京都西多摩郡瑞穂町",
    });
  });

  it("narrows to a single match when scoped by prefecture, for a name that collides nationwide (実データ: 金山町)", () => {
    const all = findCountyTownCandidates("金山町");
    expect(all.length).toBeGreaterThanOrEqual(2); // 山形県 and 福島県 both have a 金山町

    const scoped = findCountyTownCandidates("金山町", "福島県");
    expect(scoped).toHaveLength(1);
    expect(scoped[0].county).toBe("大沼郡");
  });

  it("returns an empty array for a name with no county match", () => {
    expect(findCountyTownCandidates("そんざいしないちょう")).toEqual([]);
  });
});

describe("completeCountyTown", () => {
  it("corrects a bare municipality-level path (実データ: 東京都瑞穂町)", () => {
    const result = completeCountyTown("東京都瑞穂町");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("東京都西多摩郡瑞穂町");
  });

  it("corrects a path that goes deeper than the municipality (実データ: 東京都瑞穂町高根, a 大字-level entity)", () => {
    const result = completeCountyTown("東京都瑞穂町高根");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("東京都西多摩郡瑞穂町高根");
  });

  it("resolves an ambiguous name once the prefecture narrows it (実データ: 福島県金山町)", () => {
    const result = completeCountyTown("福島県金山町");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("福島県大沼郡金山町");
  });

  it("reports ambiguity when even the prefecture doesn't disambiguate (実データ: 北海道泊村 — 国後郡 and 古宇郡 both exist)", () => {
    const result = completeCountyTown("北海道泊村");
    expect(result.type).toBe("ambiguous");
    if (result.type !== "ambiguous") throw new Error("unreachable");
    expect(result.candidates.map((c) => c.county).sort()).toEqual(["古宇郡", "国後郡"]);
  });

  it("returns none when the prefecture can't be identified", () => {
    expect(completeCountyTown("そんざいしないけん瑞穂町").type).toBe("none");
  });

  it("returns none when the path is already correct (no bare-town prefix to fix)", () => {
    expect(completeCountyTown("東京都西多摩郡瑞穂町").type).toBe("none");
  });

  it("returns none for a prefecture-only path", () => {
    expect(completeCountyTown("東京都").type).toBe("none");
  });
});
