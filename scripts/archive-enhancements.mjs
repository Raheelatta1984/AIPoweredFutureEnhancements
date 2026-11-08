#!/usr/bin/env node
/**
 * archive-enhancements.mjs — retire handover documents shipped by a merged PR.
 *
 * Inputs (env):
 *   PR_NUMBER            pull request to inspect (falls back to a full scan)
 *   GITHUB_TOKEN         REST access (read PR + changed files)
 *   GITHUB_REPOSITORY    owner/repo
 *   HANDOVER_GLOB        comma separated globs, default handovers/*​/ENH-*.md
 *   ARCHIVED_NAMES_FILE  where to write the list of archived paths
 *   DRY_RUN=true         report without touching the tree
 *
 * Rules:
 *  • explicit `Handover:` lines in the PR body win; otherwise use changed files
 *  • only Building/Built frontmatter is archivable
 *  • documents move to archived/ with status: "Archived"
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repo = process.env.GITHUB_REPOSITORY || "";
const prNumber = (process.env.PR_NUMBER || "").trim();
const dryRun = ["1", "true", "yes"].includes((process.env.DRY_RUN || "").toLowerCase());
const namesFile = process.env.ARCHIVED_NAMES_FILE || ".tmp/archived-handovers.txt";
const globs = (process.env.HANDOVER_GLOB || "handovers/*/ENH-*.md,handovers/*/*/ENH-*.md")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const FILE_PATTERN = /(^|\/)ENH-[0-9]+-[a-z0-9-]+\.md$/;

async function api(path, init = {}) {
  if (!token) throw new Error("GITHUB_TOKEN is required to read the pull request.");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "enhancements-archive",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GET ${path} → ${response.status} ${response.statusText}`);
  return response.json();
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

const matchers = globs.map(globToRegExp);

function isHandoverPath(path) {
  return FILE_PATTERN.test(path) && matchers.some((re) => re.test(path)) && !/\/archiv(ed|e)\//.test(path);
}

function readHandoverLines(body) {
  const out = [];
  for (const line of (body || "").split(/\r?\n/)) {
    const match = /^\s*(?:[-*]\s*)?Handover:\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    for (const part of match[1].split(/[,;]/)) {
      const value = part.trim().replace(/^`|`$/g, "").replace(/^\.\//, "");
      if (value) out.push(value);
    }
  }
  return out;
}

function readFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const meta = {};
  if (!match) return meta;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    meta[pair[1]] = pair[2].replace(/^"|"$/g, "");
  }
  return meta;
}

function setStatus(markdown, status) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return markdown;
  let front = match[1];
  if (/^status:.*$/m.test(front)) front = front.replace(/^status:.*$/m, `status: "${status}"`);
  else front += `\nstatus: "${status}"`;
  return markdown.slice(0, match.index) + `---\n${front}\n---` + markdown.slice(match.index + match[0].length);
}

function walk(root, depth = 0) {
  if (depth > 6) return [];
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = join(root, entry).split("\\").join("/");
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) files.push(...walk(full, depth + 1));
    else if (entry.endsWith(".md")) files.push(full);
  }
  return files;
}

async function candidatesFromPr() {
  const pull = await api(`/repos/${repo}/pulls/${prNumber}`);
  const fromBody = readHandoverLines(pull.body || "");
  let changed = [];
  try {
    const files = await api(`/repos/${repo}/pulls/${prNumber}/files?per_page=100`);
    changed = (files || []).map((file) => file.filename);
  } catch (error) {
    console.warn(`archive-enhancements: could not list PR files (${error.message})`);
  }
  const fromFiles = changed.filter(isHandoverPath);
  const chosen = fromBody.length > 0 ? fromBody.filter(isHandoverPath) : fromFiles;
  return { pull, source: fromBody.length > 0 ? "pr-body" : "changed-files", paths: [...new Set(chosen)] };
}

async function candidatesFromScan() {
  return {
    pull: null,
    source: "scan",
    paths: walk("handovers").filter(isHandoverPath),
  };
}

function archiveOne(path) {
  if (!existsSync(path)) return { path, action: "skipped", reason: "missing" };
  const markdown = readFileSync(path, "utf8");
  const meta = readFrontmatter(markdown);
  const status = (meta.status || "").trim();
  if (!["Building", "Built"].includes(status)) {
    return { path, action: "skipped", reason: `status ${status || "unknown"} is not archivable` };
  }
  const target = join(dirname(path), "archived", path.split("/").pop()).split("\\").join("/");
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(path, setStatus(markdown, "Archived"), "utf8");
    renameSync(path, target);
  }
  return { path, target, action: "archived", ref: meta.ref, title: meta.title };
}

async function main() {
  let candidates;
  if (prNumber) candidates = await candidatesFromPr();
  else candidates = await candidatesFromScan();

  console.log(`archive-enhancements: source=${candidates.source} candidates=${candidates.paths.length}${dryRun ? " (dry run)" : ""}`);
  if (candidates.pull) {
    console.log(`  PR #${candidates.pull.number}: ${candidates.pull.title}`);
  }

  const results = candidates.paths.map((path) => archiveOne(path));
  for (const result of results) {
    if (result.action === "archived") {
      console.log(`  archived ${result.path} → ${result.target}`);
    } else {
      console.log(`  skipped ${result.path} (${result.reason})`);
    }
  }

  const archived = results.filter((result) => result.action === "archived");
  mkdirSync(dirname(namesFile), { recursive: true });
  writeFileSync(
    namesFile,
    archived.map((result) => `${result.target}${result.ref ? `\t${result.ref}` : ""}`).join("\n") + (archived.length ? "\n" : ""),
    "utf8",
  );

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `archived_count=${archived.length}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `archived_file=${namesFile}\n`);
  }

  console.log(`archive-enhancements: archived ${archived.length} document(s); list → ${namesFile}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      archived.length
        ? `### Archived ${archived.length} handover(s)\n${archived.map((r) => `- \`${r.target}\``).join("\n")}\n`
        : "### No handovers archived\n",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
