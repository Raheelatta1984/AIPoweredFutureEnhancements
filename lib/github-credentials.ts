/**
 * GitHub credentials entered through the UI.
 *
 * A hub that can only publish via a build-time `GITHUB_TOKEN` env var is a hub that
 * silently refuses every stage move on a host where nobody set one. Admins can paste a
 * token on /tenants instead; it is encrypted at rest with a key derived from
 * SESSION_SECRET (HKDF-SHA256) so a database dump does not leak a repo-write token.
 *
 * Resolution order — env always wins, so infrastructure can override the UI:
 *   GITHUB_TOKEN (env)  >  encrypted settings row  >  none
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { dbWritable, setting, setSetting } from "./db.ts";

const SETTING_KEY = "github_token_enc";
const DEV_FALLBACK_SECRET = "dev-only-insecure-session-secret-change-me";

export type StoredTokenState = "env" | "stored" | "none";

function secret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  return value && value.length >= 16 ? value : DEV_FALLBACK_SECRET;
}

/** Same KDF shape as the session signer: one secret, purpose-bound subkeys. */
function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret(), "utf8"), Buffer.alloc(0), "feh:github-token:v1", 32));
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

function decrypt(payload: string): string | null {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Key changed (new SESSION_SECRET) or row corrupted: treat as absent, never throw.
    return null;
  }
}

export function envToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token ? token : null;
}

/** The token to use for API calls, or null when publishing is not configured. */
export function resolveGithubToken(): string | null {
  const fromEnv = envToken();
  if (fromEnv) return fromEnv;
  const stored = setting(SETTING_KEY);
  if (!stored) return null;
  return decrypt(stored);
}

export function tokenState(): { state: StoredTokenState; hint: string | null } {
  if (envToken()) return { state: "env", hint: null };
  const stored = setting(SETTING_KEY);
  if (!stored) return { state: "none", hint: null };
  const plain = decrypt(stored);
  if (!plain) return { state: "none", hint: "The stored token can no longer be decrypted (SESSION_SECRET changed). Paste it again." };
  // Never render the token; a 4-character tail is enough to tell two tokens apart.
  return { state: "stored", hint: `…${plain.slice(-4)}` };
}

export function storeGithubToken(token: string): { ok: boolean; error?: string } {
  const trimmed = token.trim();
  if (trimmed.length < 20) return { ok: false, error: "That does not look like a GitHub token (expected 20+ characters)." };
  if (!dbWritable()) return { ok: false, error: "The database is not writable on this host, so the token cannot be stored." };
  setSetting(SETTING_KEY, encrypt(trimmed));
  return { ok: true };
}

/**
 * Operator-facing diagnosis of *why* no token is in play.
 *
 * "No token" is not one condition. An empty-but-present GITHUB_TOKEN reads as absent,
 * a rejected token reads as absent, and a token encrypted under a previous
 * SESSION_SECRET cannot be decrypted — all three used to render the same blank space.
 * This separates them so the admin page can name the actual cause.
 */
export type TokenSource =
  | { kind: "env"; ok: true }
  | { kind: "env-empty"; ok: false; detail: string }
  | { kind: "stored"; ok: true; hint: string }
  | { kind: "stored-undecryptable"; ok: false; detail: string }
  | { kind: "none"; ok: false; detail: string };

export function tokenSource(): TokenSource {
  const raw = process.env.GITHUB_TOKEN;
  if (raw !== undefined && raw.trim() !== "") return { kind: "env", ok: true };
  if (raw !== undefined && raw.trim() === "") {
    return {
      kind: "env-empty",
      ok: false,
      detail:
        "GITHUB_TOKEN exists in the environment but is empty, so it is treated as unset and it overrides anything stored here. Set a value or delete the variable.",
    };
  }
  const stored = setting(SETTING_KEY);
  if (!stored) {
    return {
      kind: "none",
      ok: false,
      detail: "No GitHub token is configured. Paste one above, or set GITHUB_TOKEN in your hosting settings.",
    };
  }
  const plain = decrypt(stored);
  if (!plain) {
    return {
      kind: "stored-undecryptable",
      ok: false,
      detail:
        "A stored token exists but cannot be decrypted — SESSION_SECRET changed since it was saved. Paste the token again.",
    };
  }
  return { kind: "stored", ok: true, hint: `…${plain.slice(-4)}` };
}

export function clearGithubToken(): void {
  if (!dbWritable()) return;
  setSetting(SETTING_KEY, "");
}
