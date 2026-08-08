import { config, userAgent } from "../../config.js";
import { AddressLodError } from "./errors.js";

interface SparqlBinding {
  [variable: string]: { type: string; value: string };
}

interface SparqlJsonResult {
  results: { bindings: SparqlBinding[] };
}

// Runs a SPARQL SELECT query and returns each row as a plain
// { [variable]: value } object (RDF term type/datatype info is dropped —
// callers that need it should query for typed literals explicitly).
export async function executeSparqlQuery(
  query: string
): Promise<Record<string, string>[]> {
  const url = `${config.addressLod.sparqlEndpoint}?query=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.addressLod.sparqlTimeoutMs
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": userAgent },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AddressLodError(
        `SPARQL query timed out after ${config.addressLod.sparqlTimeoutMs}ms`
      );
    }
    throw new AddressLodError(`SPARQL request errored: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AddressLodError(
      `SPARQL query failed: ${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as SparqlJsonResult;
  return json.results.bindings.map((binding) => {
    const row: Record<string, string> = {};
    for (const [variable, term] of Object.entries(binding)) {
      row[variable] = term.value;
    }
    return row;
  });
}
