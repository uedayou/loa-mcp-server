const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

// Standard geohash bit-interleaving encode (Gustavo Niemeyer, 2008). We only
// ever need encode (not decode/neighbor/bbox), so this is implemented
// directly rather than pulling in a library — see design-address-mcp.md §5.2
// for the survey of `ngeohash`/`latlon-geohash` and why they were passed on.
// Verified against the classic reference value ("ezs42") and against real
// schema:geo values fetched from 住所LOD in geohash.test.ts.
export function encodeGeohash(lat: number, long: number, precision: number): string {
  let latRange: [number, number] = [-90, 90];
  let lonRange: [number, number] = [-180, 180];
  let isLon = true;
  let bit = 0;
  let ch = 0;
  let geohash = "";

  while (geohash.length < precision) {
    if (isLon) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (long >= mid) {
        ch = (ch << 1) | 1;
        lonRange[0] = mid;
      } else {
        ch = ch << 1;
        lonRange[1] = mid;
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latRange[0] = mid;
      } else {
        ch = ch << 1;
        latRange[1] = mid;
      }
    }
    isLon = !isLon;

    if (++bit === 5) {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return geohash;
}
