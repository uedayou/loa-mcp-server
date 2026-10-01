import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAddressLocation } from "../../../src/lib/addressLod/ttl.js";
import { extractPopulation } from "../../../src/profiles/loa/population.js";
import type { QuadIndex } from "../../../src/core/profile.js";
import { fixtureResponse } from "../../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const SCHEMA = "http://schema.org/";

// blank node 1件分の PropertyValue を QuadIndex に組み立てる。
function indexWith(entries: { id: string; value: string }[]): QuadIndex {
  const index: QuadIndex = new Map();
  const subject = "https://uedayou.net/loa/テスト";
  index.set(
    subject,
    entries.map((_, i) => ({
      predicate: `${SCHEMA}additionalProperty`,
      object: { value: `b${i}` },
    }))
  );
  entries.forEach((e, i) => {
    index.set(`b${i}`, [
      { predicate: `${SCHEMA}propertyID`, object: { value: e.id } },
      { predicate: `${SCHEMA}value`, object: { value: e.value } },
    ]);
  });
  return index;
}

describe("extractPopulation", () => {
  it("maps loa:jinko / loa:setai to population / households and ignores loa:kbsum", () => {
    const index = indexWith([
      { id: "loa:jinko", value: "459" },
      { id: "loa:setai", value: "195" },
      { id: "loa:kbsum", value: "10" },
    ]);
    expect(extractPopulation(index, "https://uedayou.net/loa/テスト")).toEqual({
      population: 459,
      households: 195,
    });
  });

  it("keeps 0 for an uninhabited area (0 is data, not absence)", () => {
    const index = indexWith([
      { id: "loa:jinko", value: "0" },
      { id: "loa:setai", value: "0" },
    ]);
    expect(extractPopulation(index, "https://uedayou.net/loa/テスト")).toEqual({
      population: 0,
      households: 0,
    });
  });

  it("returns no keys when the entity has no additionalProperty", () => {
    const index: QuadIndex = new Map([["https://uedayou.net/loa/テスト", []]]);
    expect(extractPopulation(index, "https://uedayou.net/loa/テスト")).toEqual({});
  });

  it("skips non-numeric values and unrelated propertyIDs", () => {
    const index = indexWith([
      { id: "loa:jinko", value: "not-a-number" },
      { id: "other:thing", value: "5" },
    ]);
    expect(extractPopulation(index, "https://uedayou.net/loa/テスト")).toEqual({});
  });
});

describe("population in extracted Feature properties (実データfixture)", () => {
  it("reads population/households from a real chome .ttl (みなとみらい3丁目 = 459 / 195)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("minatomirai3chome.ttl", { contentType: "text/turtle" })
      )
    );

    const feature = await fetchAddressLocation("神奈川県横浜市西区みなとみらい3丁目");

    expect(feature.properties.population).toBe(459);
    expect(feature.properties.households).toBe(195);
    // 既存プロパティは従来どおり(customExtract が propertyMap を壊さない)
    expect(feature.properties.town).toBe("みなとみらい");
  });

  it("omits the keys for an entity without population data (既存fixture)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fixtureResponse("chome.ttl", { contentType: "text/turtle" }))
    );

    const feature = await fetchAddressLocation("東京都千代田区永田町1丁目");

    expect("population" in feature.properties).toBe(false);
    expect("households" in feature.properties).toBe(false);
  });
});
