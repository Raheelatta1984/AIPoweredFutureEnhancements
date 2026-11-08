/**
 * npm run db:migrate — applies embedded migrations to DATABASE_FILE.
 */
import { databaseFile, getDb, migrate } from "../lib/db.ts";

const file = databaseFile();
getDb();
const ran = migrate();
if (ran.length === 0) {
  console.log(`[db:migrate] up to date — ${file}`);
} else {
  console.log(`[db:migrate] applied ${ran.length} migration(s) to ${file}: ${ran.join(", ")}`);
}
process.exit(0);
