import { afterEach, describe, expect, it, vi } from "vitest";
import { listBanchi } from "../../src/tools/listBanchi.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listBanchi", () => {
  it("uses the 2-level nested hasPart query when chome is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fixtureResponse("sparql-banchi-kabukicho.json", {
        contentType: "application/sparql-results+json",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listBanchi({ town: "東京都新宿区歌舞伎町", chome: 2, limit: 200 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain(
      "terms:hasPart [ ic:丁目 2; terms:hasPart [ ic:番地 ?banchi ] ]"
    );

    const results = JSON.parse(result.content[0].text);
    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ chome: 2, banchi: "11" });
  });

  it("uses a UNION of both hasPart shapes when chome is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
        status: 200,
        headers: { "content-type": "application/sparql-results+json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listBanchi({ town: "大阪府大阪市北区角田町", limit: 200 });

    const requestedUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl).toContain("terms:hasPart [ ic:番地 ?banchi ].");
    expect(requestedUrl).toContain("UNION");
    expect(requestedUrl).toContain(
      "terms:hasPart [ ic:丁目 ?chome; terms:hasPart [ ic:番地 ?banchi ] ]."
    );
  });

  it("returns isError on a SPARQL failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 }))
    );

    const result = await listBanchi({ town: "東京都新宿区歌舞伎町", chome: 2, limit: 200 });

    expect(result.isError).toBe(true);
  });

  const emptyResults = () =>
    new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
      status: 200,
      headers: { "content-type": "application/sparql-results+json" },
    });

  it("auto-completes a 郡-omitted town name and retries (実データ: 東京都瑞穂町 -> 東京都西多摩郡瑞穂町)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(emptyResults())
      .mockResolvedValueOnce(
        fixtureResponse("sparql-banchi-kabukicho.json", {
          contentType: "application/sparql-results+json",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listBanchi({ town: "東京都瑞穂町", chome: 2, limit: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string);
    expect(secondRequestUrl).toContain("西多摩郡瑞穂町");
    const results = JSON.parse(result.content[0].text);
    expect(results.length).toBeGreaterThan(0);
    expect(result.content[1].text).toContain("西多摩郡瑞穂町");
  });

  it("notes ambiguity instead of guessing when 郡 completion is not unique (実データ: 北海道泊村)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResults());
    vi.stubGlobal("fetch", fetchMock);

    const result = await listBanchi({ town: "北海道泊村", limit: 200 });

    expect(fetchMock).toHaveBeenCalledTimes(1); // no blind retry when ambiguous
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(result.content[1].text).toContain("一意に決められない");
  });
});
