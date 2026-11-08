/**
 * One-shot boot work, executed lazily from request handlers (Node runtime only).
 *
 * This deliberately replaces an instrumentation.ts hook: Next compiles that hook for
 * the edge runtime as well, and `node:crypto` / `node:sqlite` cannot be bundled there.
 * A module-level promise keeps the work to a single run per process and lets the first
 * request wait for it instead of racing an empty database.
 */
import { ensureSeed } from "./bootstrap.ts";
import { docsSyncEnabled, syncEnhancementDocs } from "./docs-sync.ts";

let sync: Promise<void> | null = null;

/**
 * Await first-run database setup (migrate + optional demo seed), then kick the doc
 * sync off in the background. Safe to call from every page.
 */
export async function ensureBootReady(): Promise<void> {
  await ensureSeed();
  if (sync) return;
  sync = Promise.resolve();
  if (!docsSyncEnabled()) return;
  // Fire and forget: a slow or unreachable GitHub must never delay a page render.
  void syncEnhancementDocs().catch(() => {
    /* boot must never fail because a repo is unreachable */
  });
}
