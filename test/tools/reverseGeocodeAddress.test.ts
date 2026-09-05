import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocodeAddress } from "../../src/tools/reverseGeocodeAddress.js";
import { resetPrefectureGeohashCacheForTests } from "../../src/profiles/loa/geohashCache.js";
import { fixtureResponse, readFixtureText } from "../helpers/loadFixture.js";

const prefecturesGeoResponse = () =>
  fixtureResponse("sparql-prefectures-geo.json", {
    contentType: "application/sparql-results+json",
  });
const geohashResultsResponse = () =>
  fixtureResponse("sparql-geohash-xn76g.json", {
    contentType: "application/sparql-results+json",
  });
const emptyResponse = () =>
  new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
    status: 200,
    headers: { "content-type": "application/sparql-results+json" },
  });

afterEach(() => {
  vi.restoreAllMocks();
  resetPrefectureGeohashCacheForTests();
});

describe("reverseGeocodeAddress", () => {
  it("uses the Stage 1 fast path when the prefecture-scoped query already finds results", async () => {
    // For this point (central Tokyo) against the 3-prefecture fixture, the
    // best (if misleading) match is 千葉県 — see prefectureGeohashCache.test.ts
    // for why. That's fine: the tool only cares that a scoped attempt that
    // succeeds is used as-is, without falling back.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(prefecturesGeoResponse())
      .mockResolvedValueOnce(geohashResultsResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocodeAddress({ lat: 35.676633, long: 139.745622, precision: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const results = JSON.parse(result.content[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(result.content[1].text).toContain("千葉県");
    expect(result.content[1].text).toContain("番地・建物レベルの特定はできない");
  });

  it("falls back to an unscoped search when the Stage-1-scoped query returns zero rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(prefecturesGeoResponse())
      .mockResolvedValueOnce(emptyResponse()) // scoped attempt: wrong prefecture guess, empty
      .mockResolvedValueOnce(geohashResultsResponse()); // unscoped fallback: succeeds
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocodeAddress({ lat: 35.676633, long: 139.745622, precision: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdRequestUrl = decodeURIComponent(fetchMock.mock.calls[2][0] as string);
    expect(thirdRequestUrl).not.toContain("ic:都道府県");
    const results = JSON.parse(result.content[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(result.content[1].text).toContain("全国を検索した");
  });

  it("skips straight to the unscoped search when no prefecture is a trustworthy match", async () => {
    // Sapporo's geohash shares too little prefix with any of the 3 fixture
    // prefectures (best overlap is 2 chars, below the trust threshold of 3).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(prefecturesGeoResponse())
      .mockResolvedValueOnce(geohashResultsResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocodeAddress({ lat: 43.0621, long: 141.3544, precision: 5 });

    // Only 2 calls: the prefecture cache fetch, then straight to the
    // unscoped Stage 2 query — no wasted scoped attempt.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondRequestUrl).not.toContain("ic:都道府県");
    expect(result.content[1].text).toContain("全国を検索した");
  });

  it("returns isError when both the prefecture cache and the fallback search fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      })
    );

    const result = await reverseGeocodeAddress({ lat: 35.676633, long: 139.745622, precision: 5 });

    expect(result.isError).toBe(true);
  });

  it("still returns a (empty) result rather than throwing when the fallback search legitimately finds nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(prefecturesGeoResponse())
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(emptyResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocodeAddress({ lat: 35.676633, long: 139.745622, precision: 5 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});

// Sanity check that the fixture used above is genuine SPARQL JSON, not
// accidentally an empty/malformed file (guards against a silently-broken
// fixture making every test above pass for the wrong reason).
describe("sparql-geohash-xn76g.json fixture", () => {
  it("contains at least one binding", () => {
    const parsed = JSON.parse(readFixtureText("sparql-geohash-xn76g.json"));
    expect(parsed.results.bindings.length).toBeGreaterThan(0);
  });
});
