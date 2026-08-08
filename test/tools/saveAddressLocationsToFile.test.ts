import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  saveAddressLocationsToFile,
  inputSchema,
  MAX_ADDRESSES,
} from "../../src/tools/saveAddressLocationsToFile.js";
import { fixtureResponse } from "../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "loa-mcp-server-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("saveAddressLocationsToFile", () => {
  it("writes a FeatureCollection to the given path and reports it without inlining the geometry", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal(
        "fetch",
        mockFetchByPath([
          { match: "永田町1丁目7", fixture: "banchi.ttl" },
          { match: "永田町1丁目", fixture: "chome.ttl" },
        ])
      );

      const outputPath = join(dir, "out.geojson");
      const addresses = ["東京都千代田区永田町1丁目7", "東京都千代田区永田町1丁目"];
      const result = await saveAddressLocationsToFile({ addresses, outputPath });

      expect(result.isError).toBe(false);
      // the geometry itself must never appear inline in the response.
      expect(result.content.every((c) => !c.text.includes('"FeatureCollection"'))).toBe(true);
      expect(result.content.some((c) => c.text.includes(outputPath))).toBe(true);
      expect(result.content.some((c) => c.text.includes("2件中2件"))).toBe(true);

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.type).toBe("FeatureCollection");
      expect(written.features).toHaveLength(2);
      expect(written.features[0].properties.query).toBe(addresses[0]);
      expect(written.features[1].properties.query).toBe(addresses[1]);
    });
  });

  it("creates missing parent directories", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

      const outputPath = join(dir, "nested", "deeper", "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["東京都千代田区永田町1丁目"],
        outputPath,
      });

      expect(result.isError).toBe(false);
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features).toHaveLength(1);
    });
  });

  it("keeps partial results and reports unresolved addresses without failing the whole call", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

      const outputPath = join(dir, "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["東京都千代田区永田町1丁目", "存在しない住所"],
        outputPath,
      });

      expect(result.isError).toBe(false);
      const unresolvedNote = result.content.find((c) => c.text.includes("解決できなかった住所"));
      expect(unresolvedNote?.text).toContain("存在しない住所");

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features).toHaveLength(1);
    });
  });

  it("reports isError and writes no file when every address fails to resolve", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(fixtureResponse("not-found.txt", { status: 404, contentType: "text/plain" }))
      );

      const outputPath = join(dir, "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["存在しない住所1", "存在しない住所2"],
        outputPath,
      });

      expect(result.isError).toBe(true);
      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    });
  });

  it("applies topological simplify across the batch, same as get_address_locations", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetchByPath([{ match: "永田町1丁目", fixture: "chome.ttl" }]));

      const outputPath = join(dir, "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["東京都千代田区永田町1丁目"],
        simplify: "high",
        outputPath,
      });

      expect(result.isError).toBe(false);
      expect(result.content.some((c) => c.text.includes("simplify:'high'"))).toBe(true);

      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features[0].geometry.coordinates[0].length).toBeLessThan(43);
    });
  });

  it("drops small islands when dropSmallIslands:true and every address is a prefecture", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

      const outputPath = join(dir, "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["鳥取県"],
        dropSmallIslands: true,
        outputPath,
      });

      expect(result.isError).toBe(false);
      expect(result.content.some((c) => c.text.includes("dropSmallIslands:true"))).toBe(true);
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.features[0].geometry.type).toBe("Polygon");
    });
  });

  it("rejects dropSmallIslands:true when the batch includes a non-prefecture address, without writing a file", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal(
        "fetch",
        mockFetchByPath([
          { match: "鳥取県", fixture: "prefecture.ttl" },
          { match: "永田町1丁目", fixture: "chome.ttl" },
        ])
      );

      const outputPath = join(dir, "out.geojson");
      const result = await saveAddressLocationsToFile({
        addresses: ["鳥取県", "東京都千代田区永田町1丁目"],
        dropSmallIslands: true,
        outputPath,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("都道府県ではない");
      await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    });
  });

  it("rejects degenerateIslands without dropSmallIslands:true", async () => {
    await withTempDir(async (dir) => {
      vi.stubGlobal("fetch", mockFetchByPath([{ match: "鳥取県", fixture: "prefecture.ttl" }]));

      const result = await saveAddressLocationsToFile({
        addresses: ["鳥取県"],
        simplify: "high",
        degenerateIslands: "omit",
        outputPath: join(dir, "out.geojson"),
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("degenerateIslands");
    });
  });

  it("rejects more than the configured maximum batch size at the schema level", () => {
    const schema = z.object(inputSchema);
    const tooMany = Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: tooMany, outputPath: "out.geojson" }).success).toBe(false);
    const atLimit = Array.from({ length: MAX_ADDRESSES }, (_, i) => `住所${i}`);
    expect(schema.safeParse({ addresses: atLimit, outputPath: "out.geojson" }).success).toBe(true);
  });

  it("rejects an empty outputPath at the schema level", () => {
    const schema = z.object(inputSchema);
    expect(schema.safeParse({ addresses: ["住所"], outputPath: "" }).success).toBe(false);
  });
});
