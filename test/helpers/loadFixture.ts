import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/addressLod/", import.meta.url));

export function readFixtureText(name: string): string {
  return readFileSync(`${FIXTURE_DIR}${name}`, "utf-8");
}

export function readFixtureJson<T = unknown>(name: string): T {
  return JSON.parse(readFixtureText(name)) as T;
}

export function fixtureResponse(
  name: string,
  init: { status?: number; contentType?: string } = {}
): Response {
  return new Response(readFixtureText(name), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/plain; charset=UTF-8" },
  });
}
