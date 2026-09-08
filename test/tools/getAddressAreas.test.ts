import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getAddressAreas, inputSchema, MAX_ADDRESSES } from "../../src/profiles/loa/tools/getAddressAreas.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchByPath(
  routes: { match: string; fixture: string; status?: number; contentType?: string }[]
) {
  return vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(url);
    const route = routes.find((r) => decoded.includes(r.match));
    if (route) {
      return fixtureResponse(route.fixture, {
        status: route.status,
        contentType: route.contentType ?? "text/turtle",
      });
    }
    return fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" });
  });
}

describe("getAddressAreas", () => {
  it("returns the area (km^2) for a resolvable polygon-bearing address", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

    const result = await getAddressAreas({ addresses: ["東京都千代田区永田町1丁目"] });

    expect(result.isError).toBe(false);
    const areas = JSON.parse(result.content[0].text);
    expect(areas).toHaveLength(1);
    expect(areas[0].query).toBe("東京都千代田区永田町1丁目");
    expect(areas[0].areaKm2).toBeGreaterThan(0);
    expect(result.content.some((c) => c.text.includes("1件中1件の面積を算出した"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("平面近似"))).toBe(true);
  });

  it("excludes point-only (banchi-level) addresses and reports why", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目7", fixture: "banchi.ttl" }]));

    const result = await getAddressAreas({ addresses: ["東京都千代田区永田町1丁目7"] });

    expect(result.isError).toBe(true); // the only address resolved to a Point, so areas is empty
    const areas = JSON.parse(result.content[0].text);
    expect(areas).toHaveLength(0);
    const reasonNote = result.content.find((c) => c.text.includes("面積を算出できなかった住所"));
    expect(reasonNote?.text).toContain("東京都千代田区永田町1丁目7");
    expect(reasonNote?.text).toContain("ポイントのみでポリゴンを持たない");
  });

  it("keeps partial results and reports unresolved addresses without failing the whole call", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

    const result = await getAddressAreas({
      addresses: ["東京都千代田区永田町1丁目", "存在しない住所"],
    });

    expect(result.isError).toBe(false);
    const areas = JSON.parse(result.content[0].text);
    expect(areas).toHaveLength(1);
    const reasonNote = result.content.find((c) => c.text.includes("面積を算出できなかった住所"));
    expect(reasonNote?.text).toContain("存在しない住所");
  });

  it("sums all MultiPolygon parts (including small islands) for a prefecture", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

    const result = await getAddressAreas({ addresses: ["鳥取県"] });

    expect(result.isError).toBe(false);
    const areas = JSON.parse(result.content[0].text);
    expect(areas[0].name).toBe("鳥取県");
    expect(areas[0].areaKm2).toBeGreaterThan(0);
  });

  it("reports isError only when nothing produced an area", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" }))
    );

    const result = await getAddressAreas({ addresses: ["存在しない住所1", "存在しない住所2"] });

    expect(result.isError).toBe(true);
    const areas = JSON.parse(result.content[0].text);
    expect(areas).toHaveLength(0);
  });

  it("rejects more than the configured maximum batch size at the schema level", () => {
    const schema = z.object(inputSchema);
    const tooMany = Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: tooMany }).success).toBe(false);
    const atLimit = Array.from({ length: MAX_ADDRESSES }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: atLimit }).success).toBe(true);
  });
});
