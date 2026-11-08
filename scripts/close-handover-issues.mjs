#!/usr/bin/env node
/**
 * close-handover-issues.mjs — closes the intake issues whose handover documents
 * were just archived. Reads ARCHIVED_NAMES_FILE (written by
 * archive-enhancements.mjs) and matches issues by their hidden marker.
 */
import { existsSync, readFileSync } from "node:fs";

const API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repo = process.env.GITHUB_REPOSITORY || "";
const namesFile = process.env.ARCHIVED_NAMES_FILE || ".tmp/archived-handovers.txt";
const label = process.env.LABEL || "arena-handover";
const MARKER = /<!--\s*handover:\s*([^\s]+?)\s*-->/;

if (!token) {
  console.error("close-handover-issues: GITHUB_TOKEN is required.");
  process.exit(1);
}
if (!repo) {
  console.error("close-handover-issues: GITHUB_REPOSITORY is required.");
  process.exit(1);
}

if (!existsSync(namesFile)) {
  console.log("close-handover-issues: no archived list, nothing to close.");
  process.exit(0);
}

const archivedPaths = readFileSync(namesFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.split("\t")[0].trim())
  .filter(Boolean);

if (archivedPaths.length === 0) {
  console.log("close-handover-issues: archived list is empty.");
  process.exit(0);
}

/** An archived doc keeps its name; the active path is the same file one level up. */
const activeEquivalents = archivedPaths.map((path) => path.replace(/\/archiv(ed|e)\//, "/"));

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "enhancements-close-issues",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} → ${response.status} ${response.statusText}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  const issues = await api(`/repos/${repo}/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`);
  let closed = 0;
  for (const issue of issues ?? []) {
    if (issue.pull_request) continue;
    const match = MARKER.exec(issue.body || "");
    if (!match) continue;
    const docPath = match[1];
    const target = activeEquivalents.find((candidate) => candidate === docPath) ??
      archivedPaths.find((candidate) => candidate.endsWith(docPath.split("/").pop()));
    if (!target) continue;

    await api(`/repos/${repo}/issues/${issue.number}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: `Handover document archived by a merged pull request: \`${target}\`. Closing this intake issue.`,
      }),
    });
    await api(`/repos/${repo}/issues/${issue.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    closed += 1;
    console.log(`closed #${issue.number} → ${target}`);
  }
  console.log(`close-handover-issues: closed ${closed} issue(s).`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Closed ${closed} intake issue(s).\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
