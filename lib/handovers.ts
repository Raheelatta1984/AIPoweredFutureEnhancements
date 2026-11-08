/**
 * Local mirror of the handover documents.
 *
 * Publishing writes to the *consuming* repository over the GitHub API. When no
 * token is available (demo, offline, CI) the hub keeps an identical mirror in
 * handovers/<tenant-slug>/ so the feature is demonstrable end to end: the same
 * files the workflows would see, the same frontmatter, the same archived/ layout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { handoverFileName, isArchivedDocPath } from "./rules.ts";
import { buildEnhancementMarkdown } from "./vault.ts";
import type { Enhancement, TenantView } from "./types.ts";
import type { MarkdownRecord } from "./vault.ts";

/** Lazy (not module-level) so tests and env overrides can flip it per call. */
function serverless(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Root of the local handover mirror.
 *
 * On a serverless host the bundle is read-only, so writes go to /tmp exactly like
 * the vault does — otherwise publishing would throw EROFS on first use. Reads check
 * /tmp first, then fall back to the mirror committed in the repository, so the demo
 * documents are still visible on a fresh deploy.
 */
export function handoverMirrorRoot(): string {
  const explicit = process.env.ENHANCEMENT_HANDOVER_DIR?.trim();
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  if (serverless()) return "/tmp/enhancements/handovers";
  return join(resolve(process.cwd()), "handovers");
}

/** Repo copy of the mirror (read-only fallback on serverless). */
function committedMirrorRoot(): string {
  return join(resolve(process.cwd()), "handovers");
}

/** Every root that may hold mirrored documents, most-specific first. */
function mirrorRoots(): string[] {
  const roots = [handoverMirrorRoot()];
  const committed = committedMirrorRoot();
  if (!roots.includes(committed) && existsSync(committed)) roots.push(committed);
  return roots;
}

/** handovers/<slug>/ENH-0001-title-<id>.md (or .../archived/…) */
export function mirrorRelativePath(
  tenant: Pick<TenantView, "slug">,
  enhancement: Pick<Enhancement, "ref" | "title" | "id">,
  archived = false,
): string {
  const name = handoverFileName(enhancement.ref, enhancement.title, enhancement.id);
  return archived ? `handovers/${tenant.slug}/archived/${name}` : `handovers/${tenant.slug}/${name}`;
}

/** Writes the mirror file (used by the seed and by offline publishing). */
export function writeHandoverMirror(enhancement: MarkdownRecord, tenant: TenantView, archived = false): string {
  const relative = mirrorRelativePath(tenant, enhancement, archived);
  // Strip the leading `handovers/` segment: the root already points at it.
  const absolute = join(handoverMirrorRoot(), relative.replace(/^handovers\//, ""));
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(
    absolute,
    buildEnhancementMarkdown(enhancement, tenant, { kind: "handover", statusOverride: enhancement.status }),
    "utf8",
  );
  return relative;
}

/**
 * Seed-only variant: skip documents that already exist so a re-seed cannot rewrite
 * committed fixtures (which would churn `submitted_on` in every file).
 */
export function writeHandoverMirrorIfAbsent(
  enhancement: MarkdownRecord,
  tenant: TenantView,
  archived = false,
): string {
  const relative = mirrorRelativePath(tenant, enhancement, archived);
  const absolute = join(handoverMirrorRoot(), relative.replace(/^handovers\//, ""));
  if (existsSync(absolute)) return relative;
  return writeHandoverMirror(enhancement, tenant, archived);
}

export type MirrorDoc = { path: string; markdown: string; archived: boolean };

/** Reads every mirrored doc for a tenant (active + archived/ + legacy archive/). */
export function listHandoverMirror(tenantSlug: string): MirrorDoc[] {
  const out: MirrorDoc[] = [];
  const seen = new Set<string>();
  for (const root of mirrorRoots()) {
    for (const doc of listMirrorUnder(join(root, tenantSlug), tenantSlug)) {
      if (seen.has(doc.path)) continue;
      seen.add(doc.path);
      out.push(doc);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function listMirrorUnder(root: string, tenantSlug: string): MirrorDoc[] {
  const out: MirrorDoc[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        visit(full, depth + 1);
      } else if (entry.endsWith(".md")) {
        const suffix = full.split(root)[1]?.replace(/^[\\/]/, "").split("\\").join("/") ?? entry;
        const relative = `handovers/${tenantSlug}/${suffix}`;
        try {
          out.push({ path: relative, markdown: readFileSync(full, "utf8"), archived: isArchivedDocPath(relative) });
        } catch {
          /* unreadable */
        }
      }
    }
  };
  visit(root, 0);
  return out;
}

/** All mirrored docs across tenants, keyed by tenant slug folder. */
export function listMirrorTenantFolders(): string[] {
  const folders = new Set<string>();
  for (const root of mirrorRoots()) {
    try {
      for (const entry of readdirSync(root)) {
        try {
          if (statSync(join(root, entry)).isDirectory()) folders.add(entry);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* root absent */
    }
  }
  return [...folders].sort();
}
