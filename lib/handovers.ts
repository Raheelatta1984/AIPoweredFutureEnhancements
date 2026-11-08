/**
 * Local mirror of the handover documents.
 *
 * Publishing writes to the *consuming* repository over the GitHub API. When no
 * token is available (demo, offline, CI) the hub keeps an identical mirror in
 * handovers/<tenant-slug>/ so the feature is demonstrable end to end: the same
 * files the workflows would see, the same frontmatter, the same archived/ layout.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { handoverFileName, isArchivedDocPath } from "./rules.ts";
import { buildEnhancementMarkdown } from "./vault.ts";
import type { Enhancement, TenantView } from "./types.ts";
import type { MarkdownRecord } from "./vault.ts";

export function handoverMirrorRoot(): string {
  return join(resolve(process.cwd()), "handovers");
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
  const absolute = join(resolve(process.cwd()), relative);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(
    absolute,
    buildEnhancementMarkdown(enhancement, tenant, { kind: "handover", statusOverride: enhancement.status }),
    "utf8",
  );
  return relative;
}

export type MirrorDoc = { path: string; markdown: string; archived: boolean };

/** Reads every mirrored doc for a tenant (active + archived/ + legacy archive/). */
export function listHandoverMirror(tenantSlug: string): MirrorDoc[] {
  const root = join(handoverMirrorRoot(), tenantSlug);
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
        const relative = `handovers/${tenantSlug}/${full.split(join(handoverMirrorRoot(), tenantSlug))[1]?.replace(/^[\\/]/, "").split("\\").join("/") ?? entry}`;
        try {
          out.push({ path: relative, markdown: readFileSync(full, "utf8"), archived: isArchivedDocPath(relative) });
        } catch {
          /* unreadable */
        }
      }
    }
  };
  visit(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** All mirrored docs across tenants, keyed by tenant slug folder. */
export function listMirrorTenantFolders(): string[] {
  try {
    return readdirSync(handoverMirrorRoot())
      .filter((entry) => {
        try {
          return statSync(join(handoverMirrorRoot(), entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}
