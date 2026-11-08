#!/usr/bin/env node
/**
 * enhancement-intake.mjs — one durable GitHub issue per handover document.
 *
 * Idempotent: the issue body embeds `<!-- handover: <path> -->`; on every run we
 * look for an existing open or closed issue carrying that marker and update it
 * instead of opening a duplicate.
 *
 * Zero dependencies — plain fetch against the REST API.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repo = process.env.GITHUB_REPOSITORY || "";
const label = process.env.LABEL || "arena-handover";
const assignee = process.env.ASSIGNEE || "";
const singlePath = (process.env.SINGLE_PATH || "").trim();
const globs = (process.env.HANDOVER_GLOB || "handovers/*/ENH-*.md,handovers/*/*/ENH-*.md")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!token) {
  console.error("enhancement-intake: GITHUB_TOKEN is required.");
  process.exit(1);
}
if (!repo) {
  console.error("enhancement-intake: GITHUB_REPOSITORY is required.");
  process.exit(1);
}

const MARKER = /<!--\s*handover:\s*([^\s]+?)\s*-->/;

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "enhancements-intake",
      ...(init.headers || {}),
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${init.method || "GET"} ${path} → ${response.status} ${response.statusText}`);
  }
  if (response.status === 404) return null;
  return response.status === 204 ? null : response.json();
}

/** Minimal glob support: * inside a path segment, ** across segments. */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
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
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(root, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) files.push(...walk(full, depth + 1));
    else if (entry.endsWith(".md")) files.push(full.split("\\").join("/"));
  }
  return files;
}

function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const out = {};
  if (!match) return out;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    out[pair[1]] = pair[2].replace(/^"|"$/g, "");
  }
  return out;
}

function compactBullets(text, limit = 6) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .slice(0, limit)
    .map((line) => line.replace(/^[-*]\s+/, "- "));
}

function buildIssueBody(doc) {
  const bullets = compactBullets(doc.sections.Requirements);
  const criteria = compactBullets(doc.sections["Success criteria"], 4);
  return [
    `<!-- handover: ${doc.path} -->`,
    `**Handover document:** \`${doc.path}\``,
    "",
    "| field | value |",
    "| --- | --- |",
    `| ref | \`${doc.meta.ref ?? "—"}\` |`,
    `| tenant | \`${doc.meta.tenant ?? "—"}\` |`,
    `| status | \`${doc.meta.status ?? "—"}\` |`,
    `| submitted by | ${doc.meta.submitted_by ?? "—"} |`,
    `| app sections | ${(doc.meta.app_sections ?? "")
      .split(",")
      .map((id) => `\`${id.trim()}\``)
      .filter((id) => id !== "``")
      .join(", ") || "—"} |`,
    "",
    "### Why",
    doc.sections.Brief?.trim() || "_No brief captured._",
    "",
    "### Requirements",
    bullets.length ? bullets.join("\n") : "_No requirements captured._",
    ...(criteria.length ? ["", "### Success criteria", criteria.join("\n")] : []),
    "",
    "---",
    "",
    "### Arena Agent Mode prompt",
    "",
    "Paste this into Agent Mode with this repository connected:",
    "",
    "```text",
    `Implement the enhancement in ${doc.path}.`,
    `Ref: ${doc.meta.ref ?? "unknown"}; tenant: ${doc.meta.tenant ?? "unknown"}.`,
    "Read the document first, keep its stated scope, touch only the app sections it",
    "lists, and do not change unrelated behaviour.",
    "When the work is merged, include this line in the PR body:",
    `Handover: ${doc.path}`,
    "```",
    "",
    "<sub>Opened automatically by the enhancement intake workflow. This issue stays",
    "open until the handover document is archived by a merged PR.</sub>",
  ].join("\n");
}

async function ensureLabel() {
  const existing = await api(`/repos/${repo}/labels/${encodeURIComponent(label)}`);
  if (existing) return;
  await api(`/repos/${repo}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: label, color: "5b8cff", description: "Arena handover document awaiting implementation" }),
  });
}

async function findIssue(path) {
  const query = encodeURIComponent(`repo:${repo} is:issue "${path}"`);
  const result = await api(`/search/issues?q=${query}&per_page=20`);
  for (const item of result?.items ?? []) {
    if (MARKER.test(item.body || "") && MARKER.exec(item.body || "")[1] === path) return item;
  }
  // Fallback: scan recent issues if search indexing lags.
  const recent = await api(`/repos/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`);
  for (const item of recent ?? []) {
    const match = MARKER.exec(item.body || "");
    if (match && match[1] === path) return item;
  }
  return null;
}

async function upsertIssue(doc) {
  const body = buildIssueBody(doc);
  const title = `${doc.meta.ref ?? "ENH"} — ${doc.meta.title ?? doc.path}`;
  const existing = await findIssue(doc.path);
  if (existing) {
    if (existing.body !== body || existing.title !== title) {
      const updated = await api(`/repos/${repo}/issues/${existing.number}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      console.log(`updated #${updated.number} → ${doc.path}`);
    } else {
      console.log(`unchanged #${existing.number} → ${doc.path}`);
    }
    return { number: existing.number, created: false };
  }
  const created = await api(`/repos/${repo}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      labels: [label],
      ...(assignee ? { assignees: [assignee] } : {}),
    }),
  });
  console.log(`opened #${created.number} → ${doc.path}`);
  return { number: created.number, created: true };
}

function splitSections(markdown) {
  const body = markdown.replace(/^---[\s\S]*?---/, "");
  const sections = {};
  let current = "Intro";
  const buffer = [];
  const flush = () => {
    if (buffer.length) sections[current] = buffer.join("\n").trim();
    buffer.length = 0;
  };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      current = heading[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

async function main() {
  const all = [];
  for (const root of ["handovers"]) all.push(...walk(root));
  const matchers = globs.map(globToRegExp);

  const candidates = all
    .map((file) => file.replace(/^.*?handovers\//, "handovers/"))
    .filter((file) => (singlePath ? file === singlePath : matchers.some((re) => re.test(file))))
    .filter((file) => !/\/archiv(ed|e)\//.test(file));

  if (candidates.length === 0) {
    console.log("enhancement-intake: no handover documents to process.");
    return;
  }

  await ensureLabel();
  const results = [];
  for (const path of candidates) {
    let markdown = "";
    try {
      markdown = readFileSync(path, "utf8");
    } catch {
      console.warn(`skip unreadable ${path}`);
      continue;
    }
    const meta = frontmatter(markdown);
    if ((meta.status || "").toLowerCase() === "archived") {
      console.log(`skip archived ${path}`);
      continue;
    }
    results.push({ path, meta, sections: splitSections(markdown) });
  }

  const summary = [];
  for (const doc of results) {
    const outcome = await upsertIssue(doc);
    summary.push(`${outcome.created ? "opened" : "updated"} #${outcome.number} ${doc.path}`);
  }

  mkdirSync(".tmp", { recursive: true });
  writeFileSync(".tmp/enhancement-intake.md", summary.join("\n") + "\n", "utf8");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Enhancement intake\n\n${summary.map((line) => `- ${line}`).join("\n")}\n`,
    );
  }
  void dirname;
  console.log(`enhancement-intake: processed ${results.length} document(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
