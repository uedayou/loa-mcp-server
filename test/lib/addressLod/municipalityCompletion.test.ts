import { describe, expect, it } from "vitest";
import { completeMunicipalityOmission } from "../../../src/profiles/loa/resolution/municipalityCompletion.js";

describe("completeMunicipalityOmission", () => {
  it("tries county-town completion first (実データ: 東京都瑞穂町)", () => {
    const result = completeMunicipalityOmission("東京都瑞穂町");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("東京都西多摩郡瑞穂町");
  });

  it("falls back to designated-city-ward completion when county-town finds nothing (実データ: 神奈川県中央区)", () => {
    const result = completeMunicipalityOmission("神奈川県中央区");
    expect(result.type).toBe("corrected");
    if (result.type !== "corrected") throw new Error("unreachable");
    expect(result.entityPath).toBe("神奈川県相模原市中央区");
  });

  it("returns none when neither table has a match", () => {
    expect(completeMunicipalityOmission("東京都千代田区永田町").type).toBe("none");
  });
});
