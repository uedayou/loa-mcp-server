import { afterEach, describe, expect, it, vi } from "vitest";
import { listChildAddresses } from "../../src/tools/listChildAddresses.js";
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
    expect(requestedUrl).toContain("ont:parentFeature <https://uedayou.net/loa/東京都>");

    const results = JSON.parse(result.content[0].text);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      uri: "https://uedayou.net/loa/東京都中野区",
      label: "東京都中野区",
    });
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
    expect(secondRequestUrl).toContain("ont:parentFeature <https://uedayou.net/loa/東京都西多摩郡瑞穂町>");
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
