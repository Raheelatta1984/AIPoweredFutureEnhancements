/**
 * Pure, dependency-free rules: slugs, frontmatter, lifecycle, session tokens and
 * the GitHub handover marker. Nothing here touches the database, so it is cheap to
 * unit test and safe to import from client components.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/* ------------------------------------------------------------------ lifecycle */

export const STATUSES = [
  "Submitted",
  "Reviewing",
  "Accepted",
  "Building",
  "Built",
  "Archived",
  "Rejected",
] as const;

export type Status = (typeof STATUSES)[number];

/** Forward pipeline order. Archived/Rejected sit outside the ladder. */
export const PIPELINE: Status[] = ["Submitted", "Reviewing", "Accepted", "Building", "Built"];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function statusRank(status: string): number {
  const index = PIPELINE.indexOf(status as Status);
  return index === -1 ? -1 : index;
}

/** Archived and Rejected are terminal unless explicitly reopened. */
export function isTerminal(status: string): boolean {
  return status === "Archived" || status === "Rejected";
}

export function isArchivable(status: string): boolean {
  return status === "Building" || status === "Built";
}

/**
 * Whether a repo-side document may move an in-app record forward.
 * Archived never overwrites Rejected — a human decision outranks a file.
 */
export function canApplyDocStatus(current: string, fromDoc: "Archived" | "Built"): boolean {
  if (current === "Rejected") return false;
  if (fromDoc === "Archived") return current !== "Archived";
  // A Built handover promotes exactly the records sitting in Building. A doc can
  // never skip the pipeline on its own: Submitted stays Submitted until a human
  // (or a Building transition) moves it.
  return current === "Building";
}

export function nextStatuses(current: Status): Status[] {
  return STATUSES.filter((s) => s !== current);
}

/* ---------------------------------------------------------------------- slugs */

export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const trimmed = slug.slice(0, maxLength).replace(/-+$/g, "");
  return trimmed || "item";
}

export function formatRef(sequence: number): string {
  const n = Math.max(1, Math.trunc(sequence));
  return `ENH-${String(n).padStart(4, "0")}`;
}

export function parseRefSequence(ref: string): number | null {
  const match = /^ENH-(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Vault filename: vault/<slug>/ENH-0001-title.md */
export function vaultFileName(ref: string, title: string): string {
  return `${ref}-${slugify(title)}.md`;
}

/**
 * Handover filename. `-<record-id-suffix>` keeps two tenants (or a re-publish)
 * from colliding while still matching ^ENH-\d+-[a-z0-9-]+\.md$.
 */
export function handoverFileName(ref: string, title: string, recordId: string): string {
  const suffix = slugify(recordId, 40);
  return `${ref}-${slugify(title, 40)}-${suffix}.md`;
}

export const HANDOVER_FILE_PATTERN = /^ENH-[0-9]+-[a-z0-9-]+\.md$/;

/** True when a path looks like a handover doc (active or archived). */
export function looksLikeHandoverDoc(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return HANDOVER_FILE_PATTERN.test(base);
}

/** `handovers/qa-calendar/archived/ENH-0001-x.md` -> archived: true */
export function isArchivedDocPath(path: string): boolean {
  return /(^|\/)(archived|archive)\//.test(path);
}

/** Extracts the ref from a doc path or name, e.g. "…/ENH-0012-x.md" -> "ENH-0012". */
export function refFromPath(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const match = /^(ENH-[0-9]+)-[a-z0-9-]+\.md$/.exec(base);
  return match ? match[1] : null;
}

/* --------------------------------------------------------------- frontmatter */

/**
 * YAML-safe scalar. Values with punctuation/leading symbols are double-quoted with
 * escaped backslashes and quotes so the frontmatter always parses.
 */
export function yamlScalar(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (text === "") return '""';
  const needsQuotes =
    /^[\s#&*!|>'"%@`\-?:,[\]{}]/.test(text) ||
    /[:#\n\r\t"']/.test(text) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(text) ||
    /^-?\d+(\.\d+)?$/.test(text) ||
    text !== text.trim();
  if (!needsQuotes) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

export function yamlList(values: string[]): string {
  if (values.length === 0) return " []";
  return `\n${values.map((v) => `  - ${yamlScalar(v)}`).join("\n")}`;
}

export type FrontmatterInput = Record<string, string | string[] | number | null | undefined>;

export function buildFrontmatter(fields: FrontmatterInput): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:${yamlList(value)}`.replace(/:\n/, ":\n"));
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value ?? "")}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/** Minimal frontmatter reader (flat scalars + string lists) for repo docs. */
export function parseFrontmatter(markdown: string): Record<string, string | string[]> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return {};
  const out: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listItem = /^\s+-\s+(.*)$/.exec(rawLine);
    if (listItem && currentKey) {
      const existing = out[currentKey];
      const value = unquote(listItem[1].trim());
      out[currentKey] = Array.isArray(existing) ? [...existing, value] : [value];
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (!pair) continue;
    const [, key, rest] = pair;
    currentKey = key;
    if (rest.trim() === "") {
      out[key] = [];
    } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
      const inner = rest.trim().slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((v) => unquote(v.trim()));
    } else {
      out[key] = unquote(rest.trim());
    }
  }
  return out;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/* ------------------------------------------------------------- github marker */

/** Hidden marker embedded in intake issues so re-runs find the same issue. */
export function handoverMarker(path: string): string {
  return `<!-- handover: ${path.trim()} -->`;
}

export function readHandoverMarker(body: string): string | null {
  const match = /<!--\s*handover:\s*([^\s]+?)\s*-->/.exec(body ?? "");
  return match ? match[1] : null;
}

/** Parses `Handover:` lines out of a PR body into doc paths. */
export function parseHandoverLines(body: string): string[] {
  const out: string[] = [];
  for (const line of (body ?? "").split(/\r?\n/)) {
    const match = /^\s*(?:[-*]\s*)?Handover:\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    for (const part of match[1].split(/[,;]/)) {
      const value = part.trim().replace(/^`|`$/g, "");
      if (value) out.push(value);
    }
  }
  return out;
}

/* ------------------------------------------------------------------- sessions */

export type SessionPayload = {
  sub: string; // person id
  sid: string; // sessions row id (revocation handle)
  iat: number;
  exp: number;
};

export const SESSION_COOKIE = "feh_session";
export const TENANT_COOKIE = "feh_tenant";
/**
 * Set when an admin explicitly asks to see their GitHub repositories on /tenants.
 *
 * Discovery costs two GitHub round-trips and can be slow on a cold deploy, so it runs on
 * request rather than on every render. The cookie records the intent only — the list is
 * still fetched from GitHub each time, never cached.
 */
export const REPOS_COOKIE = "feh_gh_repos";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  // Dev fallback keeps `npm run dev` zero-config. Tokens are still signed, but a
  // real secret is required in production (documented in .env.example / README).
  return "dev-only-insecure-session-secret-change-me";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input as never)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

export function signSession(payload: SessionPayload, secret = sessionSecret()): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token: string | undefined | null, nowSeconds = Math.floor(Date.now() / 1000), secret = sessionSecret()): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const parsed = JSON.parse(fromB64url(body).toString("utf8")) as SessionPayload;
    if (!parsed?.sub || !parsed?.sid || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= nowSeconds) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- helpers */

/** Uniforms line endings and trims trailing blank lines (browsers send CRLF). */
export function normaliseText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "").trim();
}

export function clampText(value: string, max = 4000): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

/* ----------------------------------------------------------- session failures */

/**
 * Why a session cookie did not become a user — the distinction that must reach the screen.
 *
 * "Only hub admins can do that" was the answer to six unrelated problems, including an
 * expired cookie and a serverless cold start. Each failure now says what happened and what
 * to do. Pure (no imports beyond crypto) so the wording is unit-testable.
 */
export type SessionFailure =
  /** No cookie at all. */
  | "no-cookie"
  /** Cookie present but the HMAC/expiry check failed (rotated SESSION_SECRET, tampering). */
  | "invalid-token"
  /** Valid signature, but this instance's database has no such person (another instance seeded). */
  | "unknown-person"
  /** The person row exists but is deactivated. */
  | "inactive-person"
  /** The sessions row is revoked — deactivation, password rotation, or "sign out everywhere". */
  | "unknown-session";

export function describeSessionFailure(failure: SessionFailure | undefined): string {
  switch (failure) {
    case "no-cookie":
      return "This action needs a signed-in admin, and this request arrived without a session. Sign in again, then retry.";
    case "invalid-token":
      return "Your session cookie is no longer valid (it was issued under a different SESSION_SECRET, or it expired). Sign in again.";
    case "unknown-person":
      return "Your session is for an account this instance cannot find — its database was rebuilt (a cold start on a serverless host). Sign in again; if that keeps happening, set a durable DATABASE_FILE.";
    case "inactive-person":
      return "This account has been deactivated, so it cannot administer the hub.";
    case "unknown-session":
      return "Your sign-in was revoked, or it belongs to an instance this hub no longer has (deactivation, a password change, or “sign out everywhere”). Sign in again — nothing was changed.";
    default:
      return "You are signed in, but this account is not a hub admin.";
  }
}
