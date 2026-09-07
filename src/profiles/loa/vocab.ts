// Full IRIs for the predicates this server reads. n3 resolves prefixes to
// full IRIs regardless of which prefix token the source Turtle used (the
// fetched .ttl files use both `rdfs:` and `r:` for the same namespace), so
// matching must always happen on the full IRI, never the prefix token.
const IC = "http://imi.go.jp/ns/core/rdf#";

export const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
export const GEOSP_AS_WKT = "http://www.opengis.net/ont/geosparql#asWKT";
export const WGS_LAT = "http://www.w3.org/2003/01/geo/wgs84_pos#lat";
export const WGS_LONG = "http://www.w3.org/2003/01/geo/wgs84_pos#long";
export const ONT_PARENT_FEATURE = "http://www.geonames.org/ontology#parentFeature";
export const TERMS_HAS_PART = "http://purl.org/dc/terms/hasPart";
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const IC_ADDRESS_TYPE = `${IC}住所型`;
export const SCHEMA_GEO = "http://schema.org/geo";
export const GEOHASH_NS = "http://geohash.org/";

export const PRED = {
  都道府県: `${IC}都道府県`,
  市区町村: `${IC}市区町村`,
  区: `${IC}区`,
  町名: `${IC}町名`,
  丁目: `${IC}丁目`,
  番地: `${IC}番地`,
  表記: `${IC}表記`,
  住所コード: `${IC}住所コード`,
  識別値: `${IC}識別値`,
} as const;

// DatasetProfile["vocab"] としての宣言的な語彙定義(design §3.1)。
// propertyMap のキー順は現行 ttl.ts の properties 構築順と一致させること
// (address_code → prefecture → ... → notation。出力の diff を壊さないため §14)。
export const LOA_VOCAB = {
  subjectSelector: { by: "rdfType", typeIri: IC_ADDRESS_TYPE } as const,
  entityTypeIri: IC_ADDRESS_TYPE,
  labelIri: RDFS_LABEL,
  labelLang: "ja",
  filterLabelLang: false,
  childToParentIri: ONT_PARENT_FEATURE,
  subPartNesting: { outerIri: TERMS_HAS_PART, innerIri: TERMS_HAS_PART },
  geometry: {
    wktIri: GEOSP_AS_WKT,
    latIri: WGS_LAT,
    longIri: WGS_LONG,
    geohashIri: SCHEMA_GEO,
    geohashPrecision: { min: 4, max: 6, default: 5 },
  },
  propertyMap: {
    address_code: { predicate: PRED.住所コード, via: PRED.識別値 },
    prefecture: { predicate: PRED.都道府県 },
    municipality: { predicate: PRED.市区町村 },
    ward: { predicate: PRED.区 },
    town: { predicate: PRED.町名 },
    chome: { predicate: PRED.丁目 },
    banchi: { predicate: PRED.番地 },
    notation: { predicate: PRED.表記 },
  },
} as const;
