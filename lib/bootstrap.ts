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

/** Ready when tenants AND people exist: a half-written seed must be repaired. */
function bootComplete(): boolean {
  return count("tenants") > 0 && count("people") > 0;
}

async function bootstrapOnce(): Promise<void> {
  migrate();
  if (!seedDemoDataEnabled()) return;
  if (bootComplete()) return;
  const { seed } = await import("../scripts/seed.ts");
  await seed();
}

/**
 * Idempotent, never rejects — but never caches a failure either.
 *
 * The previous version stored the rejected promise forever, so one transient error
 * (a locked database file, a cold-start race) disabled seeding for the whole life of
 * the instance and every later sign-in failed. A failed attempt now clears itself so
 * the next request retries.
 */
export function ensureSeed(): Promise<void> {
  if (!booted) {
    booted = bootstrapOnce().catch((error) => {
      console.error("[bootstrap] seed skipped:", error instanceof Error ? error.message : error);
      booted = null; // retry on the next request
    });
  }
  return booted;
}

/** Test/CLI helper: allow a fresh bootstrap in the same process. */
export function resetBootstrap(): void {
  booted = null;
}
