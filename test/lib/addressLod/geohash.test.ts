import { describe, expect, it } from "vitest";
import { encodeGeohash } from "../../../src/geo/geohash.js";

describe("encodeGeohash", () => {
  it("matches the classic reference value", () => {
    expect(encodeGeohash(42.6, -5.6, 5)).toBe("ezs42");
  });

  it("matches the real schema:geo value for the chome fixture (東京都千代田区永田町1丁目)", () => {
    expect(encodeGeohash(35.676633, 139.745622, 9)).toBe("xn76gyxxm");
  });

  it("matches the real schema:geo value for the banchi fixture (東京都千代田区永田町1丁目7)", () => {
    expect(encodeGeohash(35.677415, 139.744392, 9)).toBe("xn76gyyu0");
  });

  it("keeps the same prefix at lower precision (a precondition for prefix search)", () => {
    const full = encodeGeohash(35.676633, 139.745622, 9);
    const short = encodeGeohash(35.676633, 139.745622, 4);
    expect(full.startsWith(short)).toBe(true);
  });
});
