import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAddressLocation } from "../../../src/lib/addressLod/ttl.js";
import { AddressNotFoundError } from "../../../src/lib/addressLod/errors.js";
import { fixtureResponse, readFixtureJson } from "../../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAddressLocation", () => {
  it("parses a chome-level entity: polygon + representative point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");

    expect(feature.geometry?.type).toBe("Polygon");
    expect(feature.properties.uri).toBe("https://uedayou.net/loa/東京都千代田区永田町1丁目");
    expect(feature.properties.name).toBe("東京都千代田区永田町1丁目");
    expect(feature.properties.prefecture).toBe("東京都");
    expect(feature.properties.municipality).toBe("千代田区");
    expect(feature.properties.town).toBe("永田町");
    expect(feature.properties.chome).toBe("1");
    expect(feature.properties.lat).toBeCloseTo(35.676633);
    expect(feature.properties.long).toBeCloseTo(139.745622);
  });

  it("resolves address_code through the rd:住所コード blank node", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");
    expect(feature.properties.address_code).toBe("131010060001");
  });

  it("ignores sibling child-entity triples that share the same .ttl file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");
    // chome.ttl also contains `lo:東京都千代田区永田町1丁目1 ont:parentFeature ...`
    // for sibling child entities — none of that must leak into properties.
    expect(feature.properties.chome).toBe("1"); // not "11" or similar contamination
    expect(Object.keys(feature.properties)).not.toContain("1");
  });

  it("matches the origin server's own .geojson for the same entity (regression)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");
    const originGeojson = readFixtureJson<{
      geometry: unknown;
      properties: Record<string, string>;
    }>("chome.geojson");

    expect(feature.geometry).toEqual(originGeojson.geometry);
    expect(feature.properties.name).toBe(originGeojson.properties.name);
    expect(feature.properties.prefecture).toBe(originGeojson.properties.prefecture);
    expect(feature.properties.municipality).toBe(originGeojson.properties.municipality);
    expect(feature.properties.town).toBe(originGeojson.properties.town);
    expect(String(feature.properties.chome)).toBe(originGeojson.properties.chome);
    expect(String(feature.properties.lat)).toBe(originGeojson.properties.lat);
    expect(String(feature.properties.long)).toBe(originGeojson.properties.long);
  });

  it("parses a banchi-level entity: point only, no polygon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("banchi.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目7");

    expect(feature.geometry).toEqual({
      type: "Point",
      coordinates: [139.744392, 35.677415],
    });
    expect(feature.properties.banchi).toBe("7");
    expect(feature.properties.chome).toBe("1");
  });

  it("reads rdfs:label correctly even when the source .ttl uses two different prefix tokens (r: and rdfs:) for the same predicate", async () => {
    // banchi.ttl fixture genuinely contains both `r:label "..."@ja` and a
    // separate `rdfs:label "..."@ja` statement for the same subject — this
    // is exactly the real-world case that justified using n3 instead of a
    // prefix-token-dependent regex parser.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("banchi.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目7");
    expect(feature.properties.name).toBe("東京都千代田区永田町1丁目7");
  });

  it("matches the origin server's .geojson for the banchi entity (regression)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("banchi.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目7");
    const originGeojson = readFixtureJson<{ geometry: unknown }>("banchi.geojson");
    expect(feature.geometry).toEqual(originGeojson.geometry);
  });

  it("computes lat/long from the polygon centroid when wgs:lat/long are absent (実データ: 市区町村レベルはwgs:lat/longを持たない)", async () => {
    // mizuho.ttl (東京都西多摩郡瑞穂町, real data minus a simplified WKT) has
    // no wgs:lat/wgs:long triples at all — confirmed live for 都道府県/
    // 市区町村レベル entities (2026-08-06). Its geosp:asWKT is a rectangle
    // (139.317,35.789)-(139.320,35.789)-(139.320,35.792)-(139.317,35.792),
    // whose exact center is (139.3185, 35.7905).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("mizuho.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都西多摩郡瑞穂町");

    expect(feature.properties.point_source).toBe("centroid");
    expect(feature.properties.long).toBeCloseTo(139.3185);
    expect(feature.properties.lat).toBeCloseTo(35.7905);
  });

  it("dissolves a town-level MultiPolygon whose parts are really its chome sub-shapes (実データ: 東京都新宿区歌舞伎町)", async () => {
    // kabukicho.ttl's real geosp:asWKT is a 2-part MULTIPOLYGON (74pt/84pt)
    // that deliberately keeps the 1丁目/2丁目 boundary as two separate
    // polygons sharing an exact-coordinate seam — confirmed live 2026-08-06.
    // This MCP server has no use for that internal seam, so it must come
    // back as a single dissolved Polygon.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("kabukicho.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都新宿区歌舞伎町");

    expect(feature.geometry?.type).toBe("Polygon");
  });

  it("leaves point_source unset when wgs:lat/long come from the source data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );
    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");
    expect(feature.properties.point_source).toBeUndefined();
  });

  it("throws AddressNotFoundError on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" })
      )
    );
    await expect(fetchAddressLocation("存在しない住所")).rejects.toBeInstanceOf(
      AddressNotFoundError
    );
  });

  it("trusts the entity the server actually returned, even when its subject IRI differs from what was requested (実機検証: 住所LODは漢数字リクエストを算用数字の実在エンティティに解決して返す)", async () => {
    // hakonegasaki.ttl's real subject is "…箱根ケ崎" (regular-size ケ). We
    // request a completely different (and otherwise nonexistent) path here
    // to simulate 住所LOD's own ambiguity resolution (verified live: a
    // request for "…曙三条" gets served the real "…曙3条" entity's data,
    // HTTP 200, without a redirect). The extracted feature's uri must
    // reflect what the server actually returned, not what was requested.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("hakonegasaki.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都西多摩郡瑞穂町箱根がさき");

    expect(feature.properties.uri).toBe(
      "https://uedayou.net/loa/東京都西多摩郡瑞穂町箱根ケ崎"
    );
    expect(feature.properties.town).toBe("箱根ケ崎");
  });
});
