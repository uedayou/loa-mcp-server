import { describe, expect, it } from "vitest";
import { listPrefectures } from "../../src/tools/listPrefectures.js";

describe("listPrefectures", () => {
  it("returns all 47 prefecture names with no network access", async () => {
    const result = await listPrefectures();

    const names = JSON.parse(result.content[0].text);
    expect(names).toHaveLength(47);
    expect(names).toContain("東京都");
    expect(names).toContain("北海道");
    expect(names).toContain("沖縄県");
    expect(names).toContain("滋賀県");
    // 都道府県名が重複なく揃っていること。
    expect(new Set(names).size).toBe(47);
  });
});
