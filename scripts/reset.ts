/**
 * npm run db:reset — drops data/ and re-seeds. Refuses to run in production unless
 * ALLOW_PRODUCTION_RESET=true is set explicitly.
 */
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { databaseFile, closeDb } from "../lib/db.ts";
import { seed } from "./seed.ts";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_RESET !== "true") {
  console.error("[db:reset] refused: NODE_ENV=production. Set ALLOW_PRODUCTION_RESET=true to override.");
  process.exit(1);
}

const file = databaseFile();
closeDb();
for (const suffix of ["", "-wal", "-shm"]) {
  const target = `${file}${suffix}`;
  if (existsSync(target)) rmSync(target, { force: true });
}
console.log(`[db:reset] removed ${dirname(file)}/${file.split("/").pop()}`);
await seed();
process.exit(0);
