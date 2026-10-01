import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  saveChildAddressLocationsToFile,
  inputSchema,
  DEFAULT_MAX_CHILDREN,
  MAX_MAX_CHILDREN,
} from "../../src/profiles/loa/tools/saveChildAddressLocationsToFile.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE = "https://uedayou.net/loa/";

function sparqlChildren(rows: { path: string; population?: number }[]): Response {
  const bindings = rows.map((r) => ({
    child: { type: "uri", value: `${BASE}${r.path}` },
    label: { type: "literal", value: r.path, "xml:lang": "ja" },
    ...(r.population !== undefined
      ? { population: { type: "literal", value: String(r.population) } }
      : {}),
  }));
  return new Response(
    JSON.stringify({ head: { vars: ["child", "label"] }, results: { bindings } }),
    { status: 200, headers: { "content-type": "application/sparql-results+json" } }
  );
}

// SPARQL(子の一覧)と .ttl(各子の位置)の両方をモックする。ttl は URL に含まれる
// 文字列で振り分け、該当なしは404。
function mockFetch(opts: {
  children: { path: string; population?: number }[];
  ttlRoutes: { match: string; fixture: string }[];
}) {
  return vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes("sparql/query")) return sparqlChildren(opts.children);
    const route = opts.ttlRoutes.find((r) => decoded.includes(r.match));
    if (route) return fixtureResponse(route.fixture, { contentType: "text/turtle" });
    return fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" });
  });
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "loa-mcp-server-child-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const TWO_CHILDREN = [
  { path: "東京都新宿区歌舞伎町" },
  { path: "東京都千代田区永田町1丁目" },
];
const TTL_ROUTES = [
  { match: "歌舞伎町", fixture: "kabukicho.ttl" },
  { match: "永田町1丁目", fixture: "chome.ttl" },
];

describe("saveChildAddressLocationsToFile", () => {
  it("writes all direct children as one FeatureCollection, sorted by uri, without inlining geometry", async () => {
    await withTempDir(async (dir) => {
      const fetchMock = mockFetch({ children: TWO_CHILDREN, ttlRoutes: TTL_ROUTES });
      vi.stubGlobal("fetch", fetchMock);
      const outputPath = join(dir, "children.geojson");

      const result = await saveChildAddressLocationsToFile({ parent: "東京都", outputPath });

      expect(result.isError).toBe(false);
      expect(result.content.every((c) => !c.text.includes('"FeatureCollection"'))).toBe(true);
      expect(result.content.some((c) => c.text.includes(outputPath))).toBe(true);

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.type).toBe("FeatureCollection");
      expect(written.features).toHaveLength(2);
      // uri 順に固定される(「東京都千代田区…」< 「東京都新宿区…」)
      expect(written.features.map((f: { properties: { query: string } }) => f.properties.query)).toEqual([
        `${BASE}東京都千代田区永田町1丁目`,
        `${BASE}東京都新宿区歌舞伎町`,
      ]);
    });
  });

  it("asks SPARQL for maxChildren+1 children in a single query (so overflow is detectable, not silently cut)", async () => {
    await withTempDir(async (dir) => {
      const fetchMock = mockFetch({ children: TWO_CHILDREN, ttlRoutes: TTL_ROUTES });
      vi.stubGlobal("fetch", fetchMock);

      await saveChildAddressLocationsToFile({
        parent: "東京都",
        outputPath: join(dir, "a.geojson"),
        maxChildren: 7,
      });

      const sparqlCalls = fetchMock.mock.calls
        .map((c) => decodeURIComponent(c[0] as string))
        .filter((u) => u.includes("sparql/query"));
      expect(sparqlCalls).toHaveLength(1);
      expect(sparqlCalls[0]).toContain("LIMIT 8");
    });
  });

  it("never includes the parent's own polygon (it would cover the children and make them unclickable on a map)", async () => {
    await withTempDir(async (dir) => {
      const fetchMock = mockFetch({
        children: TWO_CHILDREN,
        ttlRoutes: [
          { match: "東京都千代田区.ttl", fixture: "prefecture.ttl" }, // 親の .ttl が取得できる状態でも含めない
          ...TTL_ROUTES,
        ],
      });
      vi.stubGlobal("fetch", fetchMock);
      const outputPath = join(dir, "children-only.geojson");

      // 以前あった includeParent を(LLMが勝手に付けてしまった場合を想定して)渡しても無視される。
      await saveChildAddressLocationsToFile({
        parent: "東京都千代田区",
        outputPath,
        includeParent: true,
      } as Parameters<typeof saveChildAddressLocationsToFile>[0]);

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features).toHaveLength(2); // 子だけ
      expect(
        written.features.some((f: { properties: { query: string } }) => f.properties.query === "東京都千代田区")
      ).toBe(false);
      // 親の .ttl は取得すらしない
      const urls = fetchMock.mock.calls.map((c) => decodeURIComponent(c[0] as string));
      expect(urls.some((u) => u.endsWith("東京都千代田区.ttl"))).toBe(false);
    });
  });

  it("errors without writing anything when the parent has more children than maxChildren", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetch({ children: TWO_CHILDREN, ttlRoutes: TTL_ROUTES }));
      const outputPath = join(dir, "never.geojson");

      const result = await saveChildAddressLocationsToFile({
        parent: "東京都",
        outputPath,
        maxChildren: 1, // 子が2件返る=上限超過
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("maxChildren(1件)を超えている");
      await expect(stat(outputPath)).rejects.toThrow(); // ファイルは作られない
    });
  });

  it("errors with guidance when the parent has no children (e.g. below 町丁目)", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetch({ children: [], ttlRoutes: [] }));
      const outputPath = join(dir, "none.geojson");

      const result = await saveChildAddressLocationsToFile({
        parent: "東京都千代田区永田町1丁目",
        outputPath,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("直下の子要素が見つからなかった");
      expect(result.content[0].text).toContain("get_address_location");
      await expect(stat(outputPath)).rejects.toThrow();
    });
  });

  it("keeps partial results and reports children that could not be resolved", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal(
        "fetch",
        mockFetch({
          children: [...TWO_CHILDREN, { path: "東京都存在しない町" }],
          ttlRoutes: TTL_ROUTES,
        })
      );
      const outputPath = join(dir, "partial.geojson");

      const result = await saveChildAddressLocationsToFile({ parent: "東京都", outputPath });

      expect(result.isError).toBe(false);
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features).toHaveLength(2);
      const reasonNote = result.content.find((c) => c.text.includes("解決できなかった住所"));
      expect(reasonNote?.text).toContain("東京都存在しない町");
    });
  });

  it("embeds the 参考値 note in the file when children carry population (実データ: みなとみらい3丁目)", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal(
        "fetch",
        mockFetch({
          children: [{ path: "神奈川県横浜市西区みなとみらい3丁目" }],
          ttlRoutes: [{ match: "みなとみらい3丁目", fixture: "minatomirai3chome.ttl" }],
        })
      );
      const outputPath = join(dir, "pop.geojson");

      const result = await saveChildAddressLocationsToFile({
        parent: "神奈川県横浜市西区みなとみらい",
        outputPath,
      });

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features[0].properties.population).toBe(459);
      expect(written.population_note).toContain("参考値");
      expect(result.content.some((c) => c.text.includes("参考値"))).toBe(true);
    });
  });

  it("applies topology-aware simplify across all children and notes it", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetch({ children: TWO_CHILDREN, ttlRoutes: TTL_ROUTES }));

      const result = await saveChildAddressLocationsToFile({
        parent: "東京都",
        outputPath: join(dir, "simplified.geojson"),
        simplify: "medium",
      });

      expect(result.isError).toBe(false);
      expect(result.content.some((c) => c.text.includes("simplify:'medium'"))).toBe(true);
    });
  });

  it("returns isError when the SPARQL request fails", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 500 })));
      const outputPath = join(dir, "err.geojson");

      const result = await saveChildAddressLocationsToFile({ parent: "東京都", outputPath });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("子要素の取得に失敗した");
      await expect(stat(outputPath)).rejects.toThrow();
    });
  });

  it("validates maxChildren at the schema level (default and hard cap)", () => {
    const schema = z.object(inputSchema);
    const base = { parent: "東京都", outputPath: "x.geojson" };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, maxChildren: MAX_MAX_CHILDREN }).success).toBe(true);
    expect(schema.safeParse({ ...base, maxChildren: MAX_MAX_CHILDREN + 1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, maxChildren: 0 }).success).toBe(false);
    expect(DEFAULT_MAX_CHILDREN).toBe(1200);
    // 親自身を含めるオプションは廃止(意図せず指定されると、親のポリゴンが子を覆ってしまうため)
    expect(Object.keys(inputSchema)).not.toContain("includeParent");
  });
});
