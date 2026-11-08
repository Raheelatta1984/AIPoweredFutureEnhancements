/**
 * One-shot boot work, executed lazily from the root layout (Node runtime only).
 *
 * This deliberately replaces an instrumentation.ts hook: Next compiles that hook for
 * the edge runtime as well, and `node:crypto` / `node:sqlite` cannot be bundled there.
 * A module-level guard keeps the sync to a single run per process.
 */
import { docsSyncEnabled, syncEnhancementDocs } from "./docs-sync.ts";

let started = false;

export function ensureBootSync(): void {
  if (started) return;
  started = true;
  if (!docsSyncEnabled()) return;
  // Fire and forget: a slow or unreachable GitHub must never delay a page render.
  void syncEnhancementDocs().catch(() => {
    /* boot must never fail because a repo is unreachable */
  });
}
