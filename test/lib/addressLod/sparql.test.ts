import { afterEach, describe, expect, it, vi } from "vitest";
import { executeSparqlQuery } from "../../../src/lib/addressLod/sparql.js";
import { AddressLodError } from "../../../src/lib/addressLod/errors.js";
import { fixtureResponse } from "../../helpers/loadFixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeSparqlQuery", () => {
  it("flattens SPARQL JSON bindings into plain {variable: value} rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fixtureResponse("sparql-prefectures.json", {
          contentType: "application/sparql-results+json",
        })
      )
    );

    const rows = await executeSparqlQuery("SELECT ?pref ?label WHERE { ... }");

    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      pref: "https://uedayou.net/loa/千葉県",
      label: "千葉県",
    });
  });

  it("returns an empty array for zero bindings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), {
          status: 200,
          headers: { "content-type": "application/sparql-results+json" },
        })
      )
    );
    const rows = await executeSparqlQuery("SELECT ?x WHERE { ... }");
    expect(rows).toEqual([]);
  });

  it("reads xsd:integer-typed literals as plain strings (type conversion is the caller's job)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            head: { vars: ["chome", "banchi"] },
            results: {
              bindings: [
                {
                  chome: {
                    type: "literal",
                    value: "2",
                    datatype: "http://www.w3.org/2001/XMLSchema#integer",
                  },
                  banchi: {
                    type: "literal",
                    value: "11",
                    datatype: "http://www.w3.org/2001/XMLSchema#integer",
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/sparql-results+json" } }
        )
      )
    );
    const rows = await executeSparqlQuery("SELECT ?chome ?banchi WHERE { ... }");
    expect(rows).toEqual([{ chome: "2", banchi: "11" }]);
  });

  it("throws AddressLodError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }))
    );
    await expect(executeSparqlQuery("SELECT * WHERE { ... }")).rejects.toBeInstanceOf(
      AddressLodError
    );
  });

  it("throws AddressLodError when the request is aborted (timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      })
    );
    await expect(executeSparqlQuery("SELECT * WHERE { ... }")).rejects.toThrow(
      /timed out/
    );
  });
});
