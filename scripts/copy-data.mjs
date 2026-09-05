// tsc only compiles .ts files, so static data assets referenced via
// fs.readFileSync (countyTowns.json / designatedCityWards.json, loaded by
// src/profiles/loa/resolution/*Index.ts via `new URL("./data/...", import.meta.url)`)
// must be copied into dist/ manually as part of the build.
//
// The glob keeps this working if a fork renames the profile directory: every
// `src/profiles/<id>/**/data` folder is mirrored under dist/ at the same path.
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function mirrorDataDirs(srcDir, distDir) {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = join(srcDir, entry.name);
    const to = join(distDir, entry.name);
    if (entry.name === "data") {
      cpSync(from, to, { recursive: true });
    } else {
      mirrorDataDirs(from, to);
    }
  }
}

mirrorDataDirs("src/profiles", "dist/profiles");
