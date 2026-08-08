// One-time data collection script: gathers every ward (行政区) of Japan's
// 20 ordinance-designated cities (政令指定都市) from 住所LOD and writes a
// static JSON lookup table (bare ward name -> full "市+区" candidates),
// mirroring collect-county-towns.mjs.
//
// Rationale: addresses of the form "都道府県+市+区+町" are sometimes
// written with the city name omitted ("都道府県+区+町"), which the URI
// pattern `{都道府県}{政令市}{行政区}{町丁目}` can't resolve directly.
// This is structurally the same problem as the 郡 (county) omission case.
//
// Usage: node scripts/collect-designated-city-wards.mjs

const BASE_URL = "https://uedayou.net/loa/";
const SPARQL_ENDPOINT = "https://uedayou.net/loa/sparql/query";
const REQUEST_DELAY_MS = 300;

// The 20 ordinance-designated cities (政令指定都市) as of 2026. This list
// changes only when a new city is promoted (rare — Kumamoto in 2012 was the
// most recent), so it's hardcoded like the 47 prefectures.
const DESIGNATED_CITIES = [
  { prefecture: "北海道", city: "札幌市" },
  { prefecture: "宮城県", city: "仙台市" },
  { prefecture: "埼玉県", city: "さいたま市" },
  { prefecture: "千葉県", city: "千葉市" },
  { prefecture: "神奈川県", city: "横浜市" },
  { prefecture: "神奈川県", city: "川崎市" },
  { prefecture: "神奈川県", city: "相模原市" },
  { prefecture: "新潟県", city: "新潟市" },
  { prefecture: "静岡県", city: "静岡市" },
  { prefecture: "静岡県", city: "浜松市" },
  { prefecture: "愛知県", city: "名古屋市" },
  { prefecture: "京都府", city: "京都市" },
  { prefecture: "大阪府", city: "大阪市" },
  { prefecture: "大阪府", city: "堺市" },
  { prefecture: "兵庫県", city: "神戸市" },
  { prefecture: "岡山県", city: "岡山市" },
  { prefecture: "広島県", city: "広島市" },
  { prefecture: "福岡県", city: "北九州市" },
  { prefecture: "福岡県", city: "福岡市" },
  { prefecture: "熊本県", city: "熊本市" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sparql(query) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error(`SPARQL request failed: ${res.status}`);
  const json = await res.json();
  return json.results.bindings;
}

async function getWards(prefecture, city) {
  const query = `
PREFIX ic:   <http://imi.go.jp/ns/core/rdf#>
PREFIX ont:  <http://www.geonames.org/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?ward ?label WHERE {
  ?ward a ic:住所型; rdfs:label ?label;
        ont:parentFeature <${BASE_URL}${prefecture}${city}>.
}
LIMIT 60`.trim();
  const rows = await sparql(query);
  return rows.map((r) => ({ uri: r.ward.value, label: r.label.value }));
}

function main() {
  return (async () => {
    /** @type {Map<string, {prefecture:string, city:string, ward:string, municipality:string, uri:string, label:string}[]>} */
    const index = new Map();
    let wardCount = 0;

    for (const { prefecture, city } of DESIGNATED_CITIES) {
      const wards = await getWards(prefecture, city);
      for (const w of wards) {
        const expectedPrefix = `${prefecture}${city}`;
        if (!w.label.startsWith(expectedPrefix)) continue; // sanity check
        const ward = w.label.slice(expectedPrefix.length);
        if (!ward.endsWith("区")) continue; // defensive: only keep genuine wards
        wardCount++;
        const entry = {
          prefecture,
          city,
          ward,
          municipality: `${city}${ward}`,
          uri: w.uri,
          label: w.label,
        };
        const list = index.get(ward) ?? [];
        list.push(entry);
        index.set(ward, list);
      }
      console.error(`  ${prefecture}${city}: ${wards.length} wards`);
      await sleep(REQUEST_DELAY_MS);
    }

    console.error(`total wards: ${wardCount}`);
    console.error(`unique bare ward names: ${index.size}`);

    const output = Object.fromEntries(
      [...index.entries()].sort(([a], [b]) => a.localeCompare(b, "ja"))
    );
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
