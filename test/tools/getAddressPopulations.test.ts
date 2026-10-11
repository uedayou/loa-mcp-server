import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  getAddressPopulations,
  inputSchema,
  MAX_ADDRESSES,
} from "../../src/profiles/loa/tools/getAddressPopulations.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchByPath(routes: { match: string; fixture: string }[]) {
  return vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(url);
    const route = routes.find((r) => decoded.includes(r.match));
    if (route) return fixtureResponse(route.fixture, { contentType: "text/turtle" });
    return fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" });
  });
}

describe("getAddressPopulations", () => {
  it("returns population, households, area and density for a chome (実データ: みなとみらい3丁目 459/195)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "みなとみらい3丁目", fixture: "minatomirai3chome.ttl" }])
    );

    const result = await getAddressPopulations({ addresses: ["神奈川県横浜市西区みなとみらい3丁目"] });

    expect(result.isError).toBe(false);
    const rows = JSON.parse(result.content[0].text);
    expect(rows).toHaveLength(1);
    expect(rows[0].population).toBe(459);
    expect(rows[0].households).toBe(195);
    expect(rows[0].areaKm2).toBeGreaterThan(0);
    // 密度 = 人口 / 面積(丸め誤差の範囲で一致)
    expect(rows[0].densityPerKm2).toBeCloseTo(459 / rows[0].areaKm2, -1);
    expect(result.content.some((c) => c.text.includes("参考値"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("平面近似"))).toBe(true);
  });

  it("surfaces the water survey area note only for entities that include it (実データ: 東京都港区 260,486、水面調査区の人口5人を含む)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([
        { match: "東京都港区", fixture: "minato-water.ttl" },
        { match: "みなとみらい3丁目", fixture: "minatomirai3chome.ttl" },
      ])
    );

    const result = await getAddressPopulations({
      addresses: ["東京都港区", "神奈川県横浜市西区みなとみらい3丁目"],
    });

    const rows = JSON.parse(result.content[0].text);
    const minato = rows.find((r: { query: string }) => r.query === "東京都港区");
    const minatomirai = rows.find((r: { query: string }) => r.query.includes("みなとみらい"));
    expect(minato.population).toBe(260486);
    expect(minato.adjustmentNote).toContain("水面調査区");
    expect(minato.adjustmentNote).toContain("人口5人");
    // 定型文だけの丁目には付かない(全 Feature に長文を載せない)
    expect(minatomirai.adjustmentNote).toBeUndefined();
  });

  it("excludes an entity without population data and says why", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

    const result = await getAddressPopulations({ addresses: ["東京都千代田区永田町1丁目"] });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toHaveLength(0);
    const reason = result.content.find((c) => c.text.includes("取得できなかった住所"));
    expect(reason?.text).toContain("人口・世帯数データがない");
  });

  it("excludes banchi-level (Point) addresses with the banchi-specific reason", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目7", fixture: "banchi.ttl" }]));

    const result = await getAddressPopulations({ addresses: ["東京都千代田区永田町1丁目7"] });

    expect(result.isError).toBe(true);
    const reason = result.content.find((c) => c.text.includes("取得できなかった住所"));
    expect(reason?.text).toContain("番地レベル");
  });

  it("keeps partial results and reports the rest without failing the call", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "みなとみらい3丁目", fixture: "minatomirai3chome.ttl" }])
    );

    const result = await getAddressPopulations({
      addresses: ["神奈川県横浜市西区みなとみらい3丁目", "存在しない住所"],
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toHaveLength(1);
    const reason = result.content.find((c) => c.text.includes("取得できなかった住所"));
    expect(reason?.text).toContain("存在しない住所");
  });

  it("rejects more than the configured maximum batch size at the schema level", () => {
    const schema = z.object(inputSchema);
    const tooMany = Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: tooMany }).success).toBe(false);
    const atLimit = Array.from({ length: MAX_ADDRESSES }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: atLimit }).success).toBe(true);
  });
});
