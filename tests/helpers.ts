/**
 * Shared test plumbing.
 *
 * Every test file must point DATABASE_FILE + ENHANCEMENT_VAULT_DIR at fresh
 * os.tmpdir() paths BEFORE it dynamically imports anything from ../lib — the db
 * module reads env at call time, but the vault root is resolved per call too, so
 * setting env first keeps both honest.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TestEnv = { root: string; dbFile: string; vaultDir: string; cleanup: () => void };

export function makeTestEnv(prefix = "feh-test-"): TestEnv {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dbFile = join(root, "test.db");
  const vaultDir = join(root, "vault");
  process.env.DATABASE_FILE = dbFile;
  process.env.ENHANCEMENT_VAULT_DIR = vaultDir;
  delete process.env.GITHUB_TOKEN;
  process.env.SEED_DEMO_DATA = "false";
  return {
    root,
    dbFile,
    vaultDir,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
