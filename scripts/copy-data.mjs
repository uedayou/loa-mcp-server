// tsc only compiles .ts files, so static data assets referenced via
// fs.readFileSync (like countyTowns.json) need to be copied into dist/
// manually as part of the build.
import { cpSync } from "node:fs";

cpSync("src/lib/addressLod/data", "dist/lib/addressLod/data", { recursive: true });
