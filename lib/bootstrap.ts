/**
 * First-request bootstrap.
 *
 * `npm run db:seed` is a build-time convenience, but on a serverless host the
 * database lives in /tmp and starts empty on every cold start — no build step can
 * populate it. This runs once per process, and only ever inserts the demo content
 * when the database is empty *and* demo seeding is enabled (SEED_DEMO_DATA=false
 * leaves a production hub genuinely empty).
 *
 * Request handlers `await` it, so the very first page never renders against a
 * half-built database. Failures are swallowed: a bad seed must not take the site down.
 */
import { count, migrate } from "./db.ts";
import { seedDemoDataEnabled } from "./flags.ts";

let booted: Promise<void> | null = null;

async function bootstrapOnce(): Promise<void> {
  migrate();
  if (!seedDemoDataEnabled()) return;
  if (count("tenants") > 0) return;
  const { seed } = await import("../scripts/seed.ts");
  await seed();
}

/** Idempotent, cached, never rejects. */
export function ensureSeed(): Promise<void> {
  if (!booted) {
    booted = bootstrapOnce().catch((error) => {
      console.error("[bootstrap] seed skipped:", error instanceof Error ? error.message : error);
    });
  }
  return booted;
}

/** Test/CLI helper: allow a fresh bootstrap in the same process. */
export function resetBootstrap(): void {
  booted = null;
}
