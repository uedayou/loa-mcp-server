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
