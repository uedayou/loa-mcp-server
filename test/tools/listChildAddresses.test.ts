import { afterEach, describe, expect, it, vi } from "vitest";
import { listChildAddresses } from "../../src/profiles/loa/tools/listChildAddresses.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listChildAddresses", () => {
  it("builds a percent-encoded ont:parentFeature IRI and returns the children", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-municipalities-tokyo.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChildAddresses({ parent: "東京都", limit: 100 });

    // The outer request URL is `?query=<url-encoded SPARQL>`; one decode
    // reveals the SPARQL text. The IRI itself must be raw Unicode (matching
    // how the store's actual triples are written), not percent-encoded.
    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    // プロファイル駆動化でクエリは PREFIX ではなく完全 IRI を使うようになった
    // (述語 IRI は profile.vocab.childToParentIri 由来)。IRI は生 Unicode のまま。
    expect(requestedUrl).toContain(
      "<http://www.geonames.org/ontology#parentFeature> <https://uedayou.net/loa/東京都>"
    );

    const results = JSON.parse(result.content[0].text);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      uri: "https://uedayou.net/loa/東京都中野区",
      label: "東京都中野区",
    });
  });

  it("adds population/households from loap: via OPTIONAL and numifies them (実データ: 神奈川県)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-children-population.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChildAddresses({ parent: "神奈川県", limit: 5 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain("OPTIONAL { ?child <https://uedayou.net/loa/property.ttl#jinko> ?population }");
    expect(requestedUrl).toContain("OPTIONAL { ?child <https://uedayou.net/loa/property.ttl#setai> ?households }");
    expect(requestedUrl).not.toContain("ORDER BY"); // 既定 sortBy:none は従来どおり順不同

    const results = JSON.parse(result.content[0].text);
    expect(results[0]).toEqual({
      uri: "https://uedayou.net/loa/神奈川県横浜市",
      label: "神奈川県横浜市",
      population: 3777491,
      households: 1753081,
    });
    expect(result.content.some((c) => c.text.includes("参考値"))).toBe(true);
  });

  it.each([
    ["population", "ORDER BY DESC(?population)"],
    ["households", "ORDER BY DESC(?households)"],
  ] as const)("sortBy:%s orders in SPARQL (so the top-N of ALL children is returned)", async (sortBy, clause) => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-children-population.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChildAddresses({ parent: "神奈川県", limit: 5, sortBy });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain(clause);
    expect(requestedUrl.indexOf("ORDER BY")).toBeLessThan(requestedUrl.indexOf("LIMIT 5"));
    // 型制約+ORDER BY は本番で約60倍遅いため、並べ替え時は型制約を付けない(実測、クエリ内コメント参照)
    expect(requestedUrl).not.toContain("住所型");
  });

  it("keeps the entity-type constraint when not sorting (従来クエリ互換)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-municipalities-tokyo.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChildAddresses({ parent: "東京都", limit: 100 });

    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain("住所型");
  });

  it("keeps sortBy on the retry after 郡 completion", async () => {
    const emptyBindings = new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
      status: 200,
      headers: { "content-type": "application/sparql-results+json" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyBindings)
      .mockResolvedValueOnce(
        fixtureResponse("sparql-municipalities-tokyo.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await listChildAddresses({ parent: "東京都瑞穂町", limit: 100, sortBy: "population" });

    const secondUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondUrl).toContain("西多摩郡瑞穂町");
    expect(secondUrl).toContain("ORDER BY DESC(?population)");
  });

  it("omits population keys and the reference note when no row has population (丁目など)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("sparql-municipalities-tokyo.json", {
          contentType: "application/sparql-results+json",
        })
      )
    );

    const result = await listChildAddresses({ parent: "東京都", limit: 100 });

    const results = JSON.parse(result.content[0].text);
    expect("population" in results[0]).toBe(false);
    expect(result.content.some((c) => c.text.includes("参考値"))).toBe(false);
  });

  it("returns isError on a SPARQL failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 }))
    );

    const result = await listChildAddresses({ parent: "東京都", limit: 100 });

    expect(result.isError).toBe(true);
  });

  const emptyResults = () =>
    new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
      status: 200,
      headers: { "content-type": "application/sparql-results+json" },
    });

  it("auto-completes a 郡-omitted municipality name and retries (実データ: 東京都瑞穂町 -> 東京都西多摩郡瑞穂町)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResults())
      .mockResolvedValueOnce(
        fixtureResponse("sparql-municipalities-tokyo.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChildAddresses({ parent: "東京都瑞穂町", limit: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondRequestUrl).toContain(
      "<http://www.geonames.org/ontology#parentFeature> <https://uedayou.net/loa/東京都西多摩郡瑞穂町>"
    );
    const results = JSON.parse(result.content[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(result.content[1].text).toContain("西多摩郡瑞穂町");
  });

  it("notes ambiguity instead of guessing when 郡 completion is not unique (実データ: 北海道泊村)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResults());
    vi.stubGlobal("fetch", fetchMock);

    const result = await listChildAddresses({ parent: "北海道泊村", limit: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1); // no blind retry when ambiguous
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(result.content[1].text).toContain("一意に決められない");
  });
});
