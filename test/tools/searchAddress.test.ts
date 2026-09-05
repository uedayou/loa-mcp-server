import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAddress } from "../../src/tools/searchAddress.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchAddress", () => {
  it("includes an ic:都道府県 filter in the generated SPARQL when prefecture is given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fixtureResponse("sparql-prefectures.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await searchAddress({ query: "永田町", prefecture: "東京都", limit: 20 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    // プロファイル駆動化でクエリは PREFIX ではなく完全 IRI を使う
    // (述語 IRI は profile.vocab.propertyMap.prefecture 由来)。
    expect(requestedUrl).toContain('<http://imi.go.jp/ns/core/rdf#都道府県> "東京都"@ja');
    expect(requestedUrl).toContain('CONTAINS(?label, "永田町")');
  });

  it("omits the prefecture filter and warns when prefecture is not given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fixtureResponse("sparql-prefectures.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchAddress({ query: "永田町", limit: 20 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).not.toContain("ic:都道府県");
    expect(result.content[1].text).toContain("絞り込みを推奨");
  });

  it("returns an empty array with a hint, not an error, when nothing matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
          status: 200,
          headers: { "content-type": "application/sparql-results+json" },
        })
      )
    );

    const result = await searchAddress({ query: "存在しない町", prefecture: "東京都", limit: 20 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(result.content[1].text).toContain("見つからなかった");
  });

  it("returns isError on a SPARQL failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 }))
    );

    const result = await searchAddress({ query: "永田町", prefecture: "東京都", limit: 20 });

    expect(result.isError).toBe(true);
  });

  it("switches to REGEX with a variant-character class when the query contains a known variant (実データ: 箱根ケ崎/箱根ヶ崎)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fixtureResponse("sparql-prefectures.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await searchAddress({ query: "箱根ヶ崎", prefecture: "東京都", limit: 20 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain('REGEX(?label, "箱根[ケヶヵ]崎")');
    expect(requestedUrl).not.toContain("CONTAINS");
  });

  it("stays on CONTAINS when the query has no known variant character (no behavior change for the common case)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fixtureResponse("sparql-prefectures.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await searchAddress({ query: "永田町", prefecture: "東京都", limit: 20 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain("CONTAINS");
    expect(requestedUrl).not.toContain("REGEX");
  });
});
