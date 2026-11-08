import { resolveGithubToken } from "./github-credentials.ts";

/**
 * Deployment-safety warnings surfaced in the top bar.
 *
 * A hub that silently runs with a dev session secret or an ephemeral database is a
 * hub that loses data and accepts forgeable cookies — both failures are invisible
 * until something breaks. These checks are cheap, run per render, and are rendered
 * as explicit amber tags so the operator sees them immediately.
 *
 * Pure process.env reads: safe to import from any server component.
 */

/** Lazy (not module-level) so tests and env overrides can flip it per call. */
function serverless(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function usingFallbackSecret(): boolean {
  const secret = process.env.SESSION_SECRET?.trim();
  return !secret || secret.length < 16;
}

export function ephemeralStorage(): boolean {
  return serverless() && !process.env.DATABASE_FILE?.trim();
}

export function githubPublishingConfigured(): boolean {
  // Reads the stored (UI-entered) token too — otherwise a perfectly working hub
  // would keep warning that publishing is off.
  return resolveGithubToken() !== null;
}

export type RuntimeWarning = { label: string; detail: string };

/** Everything an operator should know before trusting this deployment. */
export function runtimeWarnings(): RuntimeWarning[] {
  const warnings: RuntimeWarning[] = [];
  if (usingFallbackSecret()) {
    warnings.push({
      label: "dev session secret",
      detail:
        "SESSION_SECRET is unset or shorter than 16 characters, so tokens are signed with the public dev fallback. Set a real secret before inviting anyone.",
    });
  }
  if (ephemeralStorage()) {
    warnings.push({
      label: "ephemeral /tmp",
      detail:
        "Serverless filesystem: the SQLite database and vault live in /tmp and reset on every cold start. Point DATABASE_FILE and ENHANCEMENT_VAULT_DIR at durable storage for real use.",
    });
  }
  if (!githubPublishingConfigured()) {
    warnings.push({
      label: "publishing off",
      detail:
        "No GitHub token is configured, so handover publishing cannot reach a consuming repo and every move to Building is refused. An admin can paste one on /tenants, or set GITHUB_TOKEN.",
    });
  }
  return warnings;
}

export function isServerless(): boolean {
  return serverless();
}
