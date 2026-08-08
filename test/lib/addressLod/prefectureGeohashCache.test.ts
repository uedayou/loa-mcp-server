import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPrefectureGeohashes,
  findBestPrefectureMatch,
  resetPrefectureGeohashCacheForTests,
} from "../../../src/lib/addressLod/prefectureGeohashCache.js";
import { encodeGeohash } from "../../../src/lib/addressLod/geohash.js";
import { fixtureResponse } from "../../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetPrefectureGeohashCacheForTests();
});

describe("getPrefectureGeohashes", () => {
  it("parses the geohash suffix out of the schema:geo URI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("sparql-prefectures-geo.json", {
          contentType: "application/sparql-results+json",
        })
      )
    );

    const prefectures = await getPrefectureGeohashes();

    expect(prefectures).toContainEqual({
      uri: "https://uedayou.net/loa/東京都",
      label: "東京都",
      geohash: "xjp0",
    });
  });

  it("caches the result and does not re-fetch within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-prefectures-geo.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getPrefectureGeohashes();
    await getPrefectureGeohashes();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("findBestPrefectureMatch", () => {
  // These are the real, verified values: 東京都 -> xjp0, 千葉県 -> xn7c, 岐阜県 -> xn37.
  const prefectures = [
    { uri: "https://uedayou.net/loa/東京都", label: "東京都", geohash: "xjp0" },
    { uri: "https://uedayou.net/loa/千葉県", label: "千葉県", geohash: "xn7c" },
    { uri: "https://uedayou.net/loa/岐阜県", label: "岐阜県", geohash: "xn37" },
  ];

  it("matches a point whose geohash shares a long prefix with a prefecture's stored geohash", () => {
    // A point deep inside 千葉県's geohash cell.
    const match = findBestPrefectureMatch("xn7cabc", prefectures);
    expect(match?.label).toBe("千葉県");
  });

  it("does NOT match 東京都 for a real central-Tokyo coordinate — its stored geohash (xjp0) actually decodes near the Ogasawara Islands, not central Tokyo", () => {
    const centralTokyoGeohash = encodeGeohash(35.676633, 139.745622, 6); // "xn76gy"
    const match = findBestPrefectureMatch(centralTokyoGeohash, prefectures);
    // 東京都's stored geohash shares almost no prefix with real central-Tokyo
    // coordinates, so it must not be picked — this is the exact scenario
    // that motivated falling back to an unscoped search in the tool. Among
    // these three, 千葉県's stored geohash ("xn7c") happens to share the
    // longest prefix ("xn7") with central Tokyo's, which is itself a good
    // illustration of why a prefecture-scoped guess is only ever a hint.
    expect(match?.label).toBe("千葉県");
    expect(match?.label).not.toBe("東京都");
  });

  it("returns null when no candidate has a trustworthy overlap", () => {
    expect(findBestPrefectureMatch("zzzzzz", prefectures)).toBeNull();
  });
});
