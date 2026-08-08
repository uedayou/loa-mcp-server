// One-time data collection script: gathers every "〇〇郡△△町/村" municipality
// across all 47 prefectures from 住所LOD and writes a static JSON lookup
// table (bare town/village name -> full "郡+町" candidates) into the repo.
//
// Rationale: 住所LOD's SPARQL-exposed graph only stores the full
// "郡+町" form of ic:市区町村/rdfs:label (verified live — the .ttl file has
// an extra bare-name literal value, but that value isn't present in the
// SPARQL store), so a caller who only knows the bare town name can't
// SPARQL-match or directly build the entity URI for get_address_location /
// list_banchi / list_child_addresses. Rather than querying this at runtime
// (47 requests against the shared public endpoint, every process start),
// we collect it once here and check the resulting JSON into the repo.
//
// Usage: node scripts/collect-county-towns.mjs

const BASE_URL = "https://uedayou.net/loa/";
const SPARQL_ENDPOINT = "https://uedayou.net/loa/sparql/query";
const REQUEST_DELAY_MS = 300; // be polite to the shared public endpoint

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sparql(query) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error(`SPARQL request failed: ${res.status}`);
  const json = await res.json();
  return json.results.bindings;
}

async function getPrefectures() {
  const query = `
PREFIX ic:   <http://imi.go.jp/ns/core/rdf#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?pref ?label WHERE {
  ?pref a ic:住所型; rdfs:label ?label.
  FILTER NOT EXISTS { ?pref ic:市区町村 ?m }
}
LIMIT 60`.trim();
  const rows = await sparql(query);
  return rows.map((r) => ({ uri: r.pref.value, label: r.label.value }));
}

async function getMunicipalities(prefectureLabel) {
  const query = `
PREFIX ic:   <http://imi.go.jp/ns/core/rdf#>
PREFIX ont:  <http://www.geonames.org/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?child ?label WHERE {
  ?child a ic:住所型; rdfs:label ?label;
         ont:parentFeature <${BASE_URL}${prefectureLabel}>.
}
LIMIT 300`.trim();
  const rows = await sparql(query);
  return rows.map((r) => ({ uri: r.child.value, label: r.label.value }));
}

// "東京都西多摩郡瑞穂町" -> { prefecture: "東京都", county: "西多摩郡", town: "瑞穂町" }
const COUNTY_TOWN_RE = /^(.+?[都道府県])(.+?郡)(.+)$/;

function main() {
  return (async () => {
    const prefectures = await getPrefectures();
    console.error(`prefectures: ${prefectures.length}`);

    /** @type {Map<string, {prefecture:string, county:string, municipality:string, uri:string, label:string}[]>} */
    const index = new Map();
    let countyTownCount = 0;

    for (const pref of prefectures) {
      const municipalities = await getMunicipalities(pref.label);
      for (const m of municipalities) {
        const match = m.label.match(COUNTY_TOWN_RE);
        if (!match) continue; // not a 郡 area (city/ward/etc.)
        const [, prefecture, county, town] = match;
        if (prefecture !== pref.label) continue; // sanity check
        countyTownCount++;
        const entry = {
          prefecture,
          county,
          municipality: `${county}${town}`,
          uri: m.uri,
          label: m.label,
        };
        const list = index.get(town) ?? [];
        list.push(entry);
        index.set(town, list);
      }
      console.error(`  ${pref.label}: ${municipalities.length} municipalities`);
      await sleep(REQUEST_DELAY_MS);
    }

    console.error(`county-having municipalities: ${countyTownCount}`);
    console.error(`unique bare town names: ${index.size}`);

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
