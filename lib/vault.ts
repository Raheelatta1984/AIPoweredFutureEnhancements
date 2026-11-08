/**
 * The vault: a human-readable Markdown mirror of every proposal.
 *
 * Default location is ./vault inside this repo (git is the durable record — the
 * database is a cache in front of it). ENHANCEMENT_VAULT_DIR relocates the tree
 * for tests, CI and serverless deploys; the displayed path stays `vault/<slug>/…`
 * so the UI and docs are stable regardless of where the files physically live.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { buildFrontmatter, vaultFileName } from "./rules.ts";
import type { Enhancement, TenantView } from "./types.ts";

/**
 * Anything that can become a document. `ai_fields` arrives either as the raw JSON
 * string from the table or as an already-parsed array from a view.
 */
export type MarkdownRecord = Omit<Enhancement, "ai_fields"> & { ai_fields: string | string[] };

const SERVERLESS = Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Root of the vault tree; ENHANCEMENT_VAULT_DIR overrides for tests/deployments. */
export function vaultRoot(): string {
  const explicit = process.env.ENHANCEMENT_VAULT_DIR?.trim();
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  if (SERVERLESS) return "/tmp/enhancements/vault";
  return join(resolve(process.cwd()), "vault");
}

export function vaultDirFor(slug: string): string {
  return join(vaultRoot(), slug);
}

export function vaultArchiveDirFor(slug: string): string {
  return join(vaultDirFor(slug), "archive");
}

/** Repo-relative display path, e.g. `vault/qa-calendar/ENH-0001-x.md`. */
export function vaultRelativePath(
  enhancement: Pick<Enhancement, "ref" | "title">,
  slug: string,
  archived = false,
): string {
  const name = vaultFileName(enhancement.ref, enhancement.title);
  return archived ? `vault/${slug}/archive/${name}` : `vault/${slug}/${name}`;
}

export type VaultLocation = { path: string; absolute: string };

export function vaultLocation(
  enhancement: Pick<Enhancement, "ref" | "title">,
  slug: string,
  archived = false,
): VaultLocation {
  const name = vaultFileName(enhancement.ref, enhancement.title);
  return {
    path: vaultRelativePath(enhancement, slug, archived),
    absolute: archived ? join(vaultArchiveDirFor(slug), name) : join(vaultDirFor(slug), name),
  };
}

/** Resolves a stored display path back to an absolute file (download action). */
export function resolveVaultPath(displayPath: string): string {
  const normalised = displayPath.replace(/^vault\//, "");
  return join(vaultRoot(), normalised);
}

export type MarkdownOptions = {
  /** "vault" mirrors into this repo, "handover" is published to the tenant repo. */
  kind?: "vault" | "handover";
  statusOverride?: string;
};

/** Renders the canonical Markdown document, including frontmatter + AI footer. */
export function buildEnhancementMarkdown(
  enhancement: MarkdownRecord,
  tenant: TenantView,
  options: MarkdownOptions = {},
): string {
  const kind = options.kind ?? "vault";
  const status = options.statusOverride ?? enhancement.status;
  const aiFields = safeArray(enhancement.ai_fields);
  const sections = (enhancement.sections ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const frontmatter = buildFrontmatter({
    ref: enhancement.ref,
    title: enhancement.title,
    status,
    tenant: tenant.slug,
    app: tenant.name,
    submitted_by: enhancement.submitted_by,
    submitted_on: enhancement.created_at,
    area: enhancement.area,
    votes: enhancement.votes,
    app_sections: sections,
    ai_fields: aiFields,
    source: kind === "vault" ? "enhancements-hub/vault" : `enhancements-hub/${tenant.github_repo || "unlinked"}`,
  });

  const blocks: string[] = [frontmatter, "", `# ${enhancement.ref} — ${enhancement.title}`, ""];

  if (enhancement.raw_text?.trim()) {
    blocks.push("> " + enhancement.raw_text.trim().replace(/\n+/g, " "), "");
  }

  const body: Array<[string, string]> = [
    ["Brief", enhancement.brief],
    ["Requirements", enhancement.requirements],
    ["Impacts", enhancement.impacts],
    ["Expected outcome", enhancement.expected_outcome],
    ["Success criteria", enhancement.success_criteria],
  ];
  for (const [label, value] of body) {
    if (!value?.trim()) continue;
    blocks.push(`## ${label}`, "", value.trim(), "");
  }

  if (enhancement.outcome?.trim()) {
    blocks.push("## Outcome", "", enhancement.outcome.trim(), "");
  }

  if (sections.length > 0) {
    blocks.push("## App sections", "");
    for (const id of sections) {
      blocks.push(`- \`${id}\``);
    }
    blocks.push("");
  }

  if (enhancement.markdown?.trim()) {
    blocks.push("## Author notes", "", enhancement.markdown.trim(), "");
  }

  blocks.push("---", "");
  if (aiFields.length > 0) {
    blocks.push(
      `_AI-drafted fields: ${aiFields.join(", ")}. Everything else was written by ${enhancement.submitted_by || "the submitter"}._`,
    );
  } else {
    blocks.push(`_No AI-drafted fields — this document was written by ${enhancement.submitted_by || "the submitter"}._`);
  }
  blocks.push("");
  return blocks.join("\n");
}

function safeArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export type VaultWrite = { path: string; absolute: string; bytes: number };

function writeAt(absolute: string, markdown: string): number {
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, markdown, "utf8");
  return Buffer.byteLength(markdown, "utf8");
}

/** Writes (or rewrites) the active vault file, returning its display path. */
export function writeVaultFile(enhancement: MarkdownRecord, tenant: TenantView): VaultWrite {
  const archived = enhancement.status === "Archived";
  const location = vaultLocation(enhancement, tenant.slug, archived);
  const markdown = buildEnhancementMarkdown(enhancement, tenant);
  const bytes = writeAt(location.absolute, markdown);
  return { ...location, bytes };
}

/** Moves the vault file into archive/ (or writes it there if missing). */
export function archiveVaultFile(enhancement: MarkdownRecord, tenant: TenantView): VaultWrite {
  const active = vaultLocation(enhancement, tenant.slug, false);
  const archived = vaultLocation(enhancement, tenant.slug, true);
  mkdirSync(dirname(archived.absolute), { recursive: true });
  if (existsSync(active.absolute)) {
    if (existsSync(archived.absolute)) rmSync(archived.absolute, { force: true });
    renameSync(active.absolute, archived.absolute);
  }
  const markdown = buildEnhancementMarkdown(enhancement, tenant, { statusOverride: "Archived" });
  const bytes = writeAt(archived.absolute, markdown);
  return { ...archived, bytes };
}

/** Moves an archived file back into the active folder. */
export function reopenVaultFile(enhancement: MarkdownRecord, tenant: TenantView): VaultWrite {
  const active = vaultLocation(enhancement, tenant.slug, false);
  const archived = vaultLocation(enhancement, tenant.slug, true);
  mkdirSync(dirname(active.absolute), { recursive: true });
  if (existsSync(archived.absolute)) {
    if (existsSync(active.absolute)) rmSync(active.absolute, { force: true });
    renameSync(archived.absolute, active.absolute);
  }
  const markdown = buildEnhancementMarkdown(enhancement, tenant);
  const bytes = writeAt(active.absolute, markdown);
  return { ...active, bytes };
}

export function deleteVaultFiles(enhancement: Pick<Enhancement, "ref" | "title">, tenant: TenantView): string[] {
  const removed: string[] = [];
  for (const archived of [false, true]) {
    const location = vaultLocation(enhancement, tenant.slug, archived);
    if (existsSync(location.absolute)) {
      rmSync(location.absolute, { force: true });
      removed.push(location.path);
    }
  }
  return removed;
}

/** Reads a stored display path (or a bare absolute path) back as text. */
export function readVaultFile(displayPath: string): string | null {
  const candidates = [resolveVaultPath(displayPath), resolve(displayPath)];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
