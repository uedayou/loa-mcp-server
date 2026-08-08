import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  getAddressLocations,
  inputSchema,
  MAX_ADDRESSES,
} from "../../src/tools/getAddressLocations.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// 各住所ごとにリクエストされる .ttl パスは異なるため、URLに含まれる
// エンティティパスで振り分ける形でモックする(並列実行のため呼び出し順に
// 依存できない)。
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

describe("getAddressLocations", () => {
  it("returns a FeatureCollection combining multiple resolvable addresses, preserving input order via `query`", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([
        { match: "永田町1丁目7", fixture: "banchi.ttl" }, // must be checked before the chome route
        { match: "永田町1丁目", fixture: "chome.ttl" },
      ])
    );

    const addresses = ["東京都千代田区永田町1丁目7", "東京都千代田区永田町1丁目"];
    const result = await getAddressLocations({ addresses });

    expect(result.isError).toBe(false);
    const featureCollection = JSON.parse(result.content[0].text);
    expect(featureCollection.type).toBe("FeatureCollection");
    expect(featureCollection.features).toHaveLength(2);
    expect(featureCollection.features[0].properties.query).toBe(addresses[0]);
    expect(featureCollection.features[1].properties.query).toBe(addresses[1]);
    expect(featureCollection.features[0].geometry.type).toBe("Point");
    expect(featureCollection.features[1].geometry.type).toBe("Polygon");
    expect(result.content.some((c) => c.text.includes("2件中2件を取得した"))).toBe(true);
    // chome.ttl's real geosp:asWKT starts at 139.7472564 (7 decimals);
    // rounded to 6 it must become 139.747256.
    expect(featureCollection.features[1].geometry.coordinates[0][0]).toEqual([139.747256, 35.679528]);
  });

  it("keeps partial results and reports unresolved addresses without failing the whole call", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["東京都千代田区永田町1丁目", "存在しない住所"],
    });

    expect(result.isError).toBe(false);
    const featureCollection = JSON.parse(result.content[0].text);
    expect(featureCollection.features).toHaveLength(1);
    const unresolvedNote = result.content.find((c) => c.text.includes("解決できなかった住所"));
    expect(unresolvedNote?.text).toContain("存在しない住所");
  });

  it("reports isError only when every address fails to resolve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" })
      )
    );

    const result = await getAddressLocations({
      addresses: ["存在しない住所1", "存在しない住所2"],
    });

    expect(result.isError).toBe(true);
    const featureCollection = JSON.parse(result.content[0].text);
    expect(featureCollection.features).toHaveLength(0);
  });

  it("aggregates the point_source(centroid) and simplify notes across the batch", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([
        { match: "瑞穂町", fixture: "mizuho.ttl" }, // 市区町村レベル、wgs:lat/longなし
        { match: "永田町1丁目", fixture: "chome.ttl" },
      ])
    );

    const result = await getAddressLocations({
      addresses: ["東京都西多摩郡瑞穂町", "東京都千代田区永田町1丁目"],
      simplify: "high",
    });

    expect(result.isError).toBe(false);
    const featureCollection = JSON.parse(result.content[0].text);
    expect(featureCollection.features).toHaveLength(2);
    expect(result.content.some((c) => c.text.includes("ポリゴンの重心"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("simplify:'high'"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("境界のズレ(隙間)は発生しない"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("GeoJSON"))).toBe(true);

    // simplify is applied topologically (across the whole batch at once),
    // so the returned geometry's point count must actually be reduced —
    // check against chome.ttl's real (unsimplified) 43-point ring.
    const [, chomeFeature] = featureCollection.features;
    expect(chomeFeature.geometry.coordinates[0].length).toBeLessThan(43);
  });

  it("drops small islands across the batch when dropSmallIslands:true and every address is a prefecture", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["鳥取県"],
      dropSmallIslands: true,
    });

    expect(result.isError).toBe(false);
    const featureCollection = JSON.parse(result.content[0].text);
    expect(featureCollection.features[0].geometry.type).toBe("Polygon");
    expect(result.content.some((c) => c.text.includes("dropSmallIslands:true"))).toBe(true);
  });

  it("rejects dropSmallIslands:true when the batch includes a non-prefecture address", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([
        { match: "鳥取県", fixture: "prefecture.ttl" },
        { match: "永田町1丁目", fixture: "chome.ttl" },
      ])
    );

    const result = await getAddressLocations({
      addresses: ["鳥取県", "東京都千代田区永田町1丁目"],
      dropSmallIslands: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("都道府県ではない");
    expect(result.content[0].text).toContain("東京都千代田区永田町1丁目");
  });

  it("always includes the mandatory 'islands not shown' note whenever dropSmallIslands:true is used", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

    const result = await getAddressLocations({ addresses: ["鳥取県"], dropSmallIslands: true });

    expect(result.content.some((c) => c.text.includes("地図上には表示されない"))).toBe(true);
  });

  it("rejects degenerateIslands without dropSmallIslands:true", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

    const result = await getAddressLocations({
      addresses: ["鳥取県"],
      simplify: "high",
      degenerateIslands: "omit",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("degenerateIslands");
  });

  it("rejects degenerateIslands without a non-'none' simplify level", async () => {
    vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

    const result = await getAddressLocations({
      addresses: ["鳥取県"],
      dropSmallIslands: true,
      degenerateIslands: "omit",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("degenerateIslands");
  });

  it("omits a degenerate residual island under degenerateIslands:'omit' and reports the count, in addition to the dropSmallIslands note", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "島根県", fixture: "prefectureWithSliverIsland.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["島根県"],
      dropSmallIslands: true,
      simplify: "high",
      degenerateIslands: "omit",
    });

    expect(result.isError).toBe(false);
    const featureCollection = JSON.parse(result.content[0].text);
    // the sliver island survives dropSmallIslands (>0.01km^2) but collapses
    // under simplify:"high" and gets omitted -> only the mainland remains.
    expect(featureCollection.features[0].geometry.type).toBe("Polygon");
    expect(result.content.some((c) => c.text.includes("地図上には表示されない"))).toBe(true);
    expect(result.content.some((c) => c.text.includes('degenerateIslands:"omit"') && c.text.includes("追加で"))).toBe(true);
  });

  // 1MBエスカレーション(自動安全弁)のテスト。実際に950,000バイトを超える
  // レスポンスをfixtureだけで再現するのは非現実的(実データでの再現は
  // docs/design-batch-address-locations.md §6参照、本州34県で実測済み)なため、
  // ここではガード条件(escalationが「発動しない」べきケース)を確認する。
  it("does not attempt escalation when dropSmallIslands is not requested, even for a large response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["東京都千代田区永田町1丁目"],
      simplify: "none",
    });

    expect(result.isError).toBe(false);
    expect(result.content.some((c) => c.text.includes("自動的に最も軽量な組み合わせ"))).toBe(false);
  });

  it("does not re-run (no escalation note) when already at the strongest combination", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["鳥取県"],
      dropSmallIslands: true,
      degenerateIslands: "omit",
      simplify: "high",
    });

    expect(result.isError).toBe(false);
    expect(result.content.some((c) => c.text.includes("自動的に最も軽量な組み合わせ"))).toBe(false);
  });

  it("does not escalate a small dropSmallIslands response that is already well under the size budget", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }])
    );

    const result = await getAddressLocations({
      addresses: ["鳥取県"],
      dropSmallIslands: true,
      simplify: "medium",
    });

    expect(result.isError).toBe(false);
    expect(result.content.some((c) => c.text.includes("自動的に最も軽量な組み合わせ"))).toBe(false);
  });

  it("rejects more than the configured maximum batch size at the schema level", () => {
    const schema = z.object(inputSchema);
    const tooMany = Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: tooMany }).success).toBe(false);
    const atLimit = Array.from({ length: MAX_ADDRESSES }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: atLimit }).success).toBe(true);
  });
});
