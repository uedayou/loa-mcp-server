import { describe, expect, it } from "vitest";
import {
  normalizeToEntityPath,
  toFullIri,
  escapeSparqlLiteral,
} from "../../../src/lib/addressLod/uri.js";

describe("normalizeToEntityPath", () => {
  it("strips the base URL prefix", () => {
    expect(
      normalizeToEntityPath("https://uedayou.net/loa/東京都千代田区永田町1丁目")
    ).toBe("東京都千代田区永田町1丁目");
  });

  it("strips known format extensions", () => {
    for (const ext of [".geojson", ".ttl", ".json", ".jsonld", ".xml"]) {
      expect(normalizeToEntityPath(`東京都千代田区永田町1丁目${ext}`)).toBe(
        "東京都千代田区永田町1丁目"
      );
    }
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeToEntityPath("  東京都千代田区永田町1丁目  ")).toBe(
      "東京都千代田区永田町1丁目"
    );
  });

  it("is idempotent on an already-normalized string", () => {
    expect(normalizeToEntityPath("東京都千代田区永田町1丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
  });

  it("throws on an empty address", () => {
    expect(() => normalizeToEntityPath("")).toThrow();
    expect(() => normalizeToEntityPath("   ")).toThrow();
  });

  it("normalizes numeral formats as part of the pipeline (see numeralNormalization.test.ts for the unit-level cases)", () => {
    expect(normalizeToEntityPath("東京都千代田区永田町１丁目")).toBe(
      "東京都千代田区永田町1丁目"
    );
    expect(normalizeToEntityPath("東京都千代田区永田町1-7")).toBe(
      "東京都千代田区永田町1丁目7"
    );
  });
});

describe("toFullIri", () => {
  it("embeds the entity path as raw Unicode text (matching the real data's IRIs)", () => {
    // The store's actual triples use raw-Unicode IRIs (e.g.
    // `<https://uedayou.net/loa/東京都新宿区>`), never percent-encoded ones —
    // percent-encoding here would silently match zero triples in production.
    expect(toFullIri("東京都")).toBe("<https://uedayou.net/loa/東京都>");
  });

  it("rejects entity paths containing characters the IRIREF grammar forbids", () => {
    const malicious = '東京都"><http://evil.example/> a ic:住所型';
    expect(() => toFullIri(malicious)).toThrow();
  });

  it("rejects control characters and backslashes", () => {
    expect(() => toFullIri("東京都\n新宿区")).toThrow();
    expect(() => toFullIri("東京都\\新宿区")).toThrow();
  });
});

describe("escapeSparqlLiteral", () => {
  it("escapes backslashes, quotes, and newlines", () => {
    expect(escapeSparqlLiteral('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
  });

  it("prevents SPARQL literal breakout", () => {
    const malicious = 'a"} FILTER(true) #';
    const escaped = escapeSparqlLiteral(malicious);
    // Every double-quote in the escaped output must be backslash-escaped —
    // i.e. there must be no bare `"` that could terminate the SPARQL string
    // literal early and let the rest of the payload be parsed as query syntax.
    expect(escaped).not.toMatch(/(?<!\\)"/);
  });
});
