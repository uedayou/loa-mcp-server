import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddressLocation } from "../../src/profiles/loa/tools/getAddressLocation.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAddressLocation", () => {
  it("adds the 参考値 note both as a separate block and inside the Feature when population is present (実データ: みなとみらい3丁目)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("minatomirai3chome.ttl", { contentType: "text/turtle" })
      )
    );

    const result = await getAddressLocation({ address: "神奈川県横浜市西区みなとみらい3丁目" });

    const feature = JSON.parse(result.content[0].text);
    expect(feature.properties.population).toBe(459);
    expect(feature.population_note).toContain("参考値");
    expect(feature.population_note).toContain("必ず併記");
    expect(result.content.some((c) => c.text.includes("参考値"))).toBe(true);
  });

  it("adds no population note when the entity has no population data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目" });

    const feature = JSON.parse(result.content[0].text);
    expect("population_note" in feature).toBe(false);
    expect(result.content.some((c) => c.text.includes("参考値"))).toBe(false);
  });

  it("does not rewrite numerals inside brackets, so a real name like 富山県富山市水橋花の井町（一丁目） resolves with ONE request", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("（一丁目）")) {
        return fixtureResponse("chome.ttl", { contentType: "text/turtle" });
      }
      return fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "富山県富山市水橋花の井町（一丁目）" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).geometry.type).toBe("Polygon");
    // 括弧の中は正規化されないので、最初の1回で見つかる(書き換え前の再試行は不要)。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain("（一丁目）");
  });

  it("still falls back to the un-normalized spelling when normalization (outside brackets) made a real name not exist (合成データ)", async () => {
    // 括弧の外に漢数字の丁目を含む名前が実在する場合の保険。正規化後(「…1丁目」)が404、
    // 書き換える前(「…一丁目」)が200。
    const fetchMock = vi.fn(async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("架空町一丁目")) {
        return fixtureResponse("chome.ttl", { contentType: "text/turtle" });
      }
      return fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "東京都千代田区架空町一丁目" });

    expect(result.isError).toBeUndefined();
    const urls = fetchMock.mock.calls.map((c) => decodeURIComponent(c[0] as string));
    expect(urls[0]).toContain("架空町1丁目"); // まず正規化した表記
    expect(urls[1]).toContain("架空町一丁目"); // 404なら書き換える前の表記
    expect(urls).toHaveLength(2);
  });

  it("does not make an extra request when normalization changed nothing and the name is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "東京都存在しない町" });

    expect(result.isError).toBe(true);
    // 正規化で表記が変わらない入力なら、書き換え前の再試行は行わない(従来のリクエスト数のまま)。
    const normalizedOnly = fetchMock.mock.calls.map((c) => decodeURIComponent(c[0] as string));
    expect(new Set(normalizedOnly.filter((u) => u.includes("存在しない町"))).size).toBe(1);
  });

  it("returns a GeoJSON Feature for a bare notation string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目" });

    expect(result.isError).toBeUndefined();
    const feature = JSON.parse(result.content[0].text);
    expect(feature.geometry.type).toBe("Polygon");
  });

  it("rounds coordinates to 6 decimal places (source data has 7)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目" });

    const feature = JSON.parse(result.content[0].text);
    // chome.ttl's real geosp:asWKT starts at 139.7472564 (7 decimals);
    // rounded to 6 it must become 139.747256.
    expect(feature.geometry.coordinates[0][0]).toEqual([139.747256, 35.679528]);
    expect(result.content[0].text).not.toContain("139.7472564");
  });

  it("normalizes a full URI the same way as a bare notation string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({
      address: "https://uedayou.net/loa/東京都千代田区永田町1丁目",
    });

    expect(result.isError).toBeUndefined();
    const feature = JSON.parse(result.content[0].text);
    expect(feature.properties.uri).toBe("https://uedayou.net/loa/東京都千代田区永田町1丁目");
  });

  it("returns isError with guidance toward search_address on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" })
      )
    );

    const result = await getAddressLocation({ address: "存在しない住所" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("search_address");
  });

  it("returns isError on a timeout/network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      })
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目" });

    expect(result.isError).toBe(true);
  });

  it("appends a note and reports point_source:'centroid' when the entity has no wgs:lat/long (実データ: 市区町村レベル)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("mizuho.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都西多摩郡瑞穂町" });

    expect(result.isError).toBeUndefined();
    const feature = JSON.parse(result.content[0].text);
    expect(feature.properties.point_source).toBe("centroid");
    expect(result.content.some((c) => c.text.includes("重心"))).toBe(true);
  });

  it("auto-completes a 郡-omitted municipality name and retries (実データ: 東京都瑞穂町 -> 東京都西多摩郡瑞穂町)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" }))
      .mockResolvedValueOnce(fixtureResponse("mizuho.ttl", { contentType: "text/turtle" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "東京都瑞穂町" });

    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondRequestUrl).toContain("西多摩郡瑞穂町");
    const feature = JSON.parse(result.content[0].text);
    expect(feature.properties.uri).toBe("https://uedayou.net/loa/東京都西多摩郡瑞穂町");
    expect(result.content[1].text).toContain("西多摩郡瑞穂町");
  });

  it("reports ambiguity instead of guessing when 郡 completion is not unique (実データ: 北海道泊村)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "北海道泊村" });

    expect(result.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no blind retry when ambiguous
    expect(result.content[0].text).toContain("一意に決められない");
    expect(result.content[0].text).toContain("国後郡泊村");
    expect(result.content[0].text).toContain("古宇郡泊村");
  });

  it("leaves the geometry untouched when simplify is omitted (default 'none')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目" });

    // no simplify-note, but the rendering-hint note is always appended for
    // Polygon/MultiPolygon geometries.
    expect(result.content).toHaveLength(2);
    const feature = JSON.parse(result.content[0].text);
    expect(feature.geometry.coordinates[0]).toHaveLength(43); // full point count, untouched
    expect(result.content[1].text).toContain("GeoJSON");
  });

  it("reduces the polygon's point count and appends both a simplify-note and the rendering-hint note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({
      address: "東京都千代田区永田町1丁目",
      simplify: "high",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(3);
    const feature = JSON.parse(result.content[0].text);
    expect(feature.geometry.coordinates[0].length).toBeLessThan(43);
    expect(result.content[1].text).toContain("simplify:'high'");
    expect(result.content[2].text).toContain("GeoJSON");
  });

  it("does not append the rendering-hint note for a Point geometry (banchi level)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("banchi.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "東京都千代田区永田町1丁目7" });

    expect(result.content).toHaveLength(1);
  });

  it("auto-completes a 異体字(ケ/ヶ) mismatch and retries (実データ: 箱根ヶ崎と問い合わせても正式表記の箱根ケ崎で解決する)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" }))
      .mockResolvedValueOnce(fixtureResponse("hakonegasaki.ttl", { contentType: "text/turtle" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAddressLocation({ address: "東京都西多摩郡瑞穂町箱根ヶ崎" });

    expect(result.isError).toBeUndefined();
    // Two fetches: the original spelling (404), then a variant candidate
    // (no county/designated-city completion applies here, so this is the
    // second call overall). The first variant tried is "ケ" (regular size),
    // which matches the fixture's real subject IRI.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondRequestUrl).toContain("箱根ケ崎");
    const feature = JSON.parse(result.content[0].text);
    expect(feature.properties.uri).toBe("https://uedayou.net/loa/東京都西多摩郡瑞穂町箱根ケ崎");
    expect(result.content[1].text).toContain("異体字");
  });

  it("drops the tiny island part and keeps the mainland when dropSmallIslands:true is used on a prefecture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("prefecture.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({ address: "鳥取県", dropSmallIslands: true });

    expect(result.isError).toBeUndefined();
    const feature = JSON.parse(result.content[0].text);
    // the tiny island collapses away, leaving only the mainland part -> Polygon, not MultiPolygon
    expect(feature.geometry.type).toBe("Polygon");
    expect(result.content.some((c) => c.text.includes("dropSmallIslands:true"))).toBe(true);
    expect(result.content.some((c) => c.text.includes("1個除外した"))).toBe(true);
  });

  it("rejects dropSmallIslands:true for a non-prefecture-level address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const result = await getAddressLocation({
      address: "東京都千代田区永田町1丁目",
      dropSmallIslands: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("都道府県ではない");
  });
});
