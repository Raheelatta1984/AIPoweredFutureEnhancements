/**
 * Pure rules: slugs, refs, frontmatter, lifecycle, sessions, markers.
 * No database, no filesystem — runs in milliseconds.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrontmatter,
  canApplyDocStatus,
  formatRef,
  handoverFileName,
  HANDOVER_FILE_PATTERN,
  handoverMarker,
  isArchivable,
  isArchivedDocPath,
  looksLikeHandoverDoc,
  parseFrontmatter,
  parseHandoverLines,
  parseRefSequence,
  readHandoverMarker,
  refFromPath,
  signSession,
  slugify,
  statusRank,
  vaultFileName,
  verifySession,
  yamlScalar,
  type SessionPayload,
} from "../lib/rules.ts";

test("slugify normalises words, punctuation and accents", () => {
  assert.equal(slugify("Attach evidence photos — from the checklist!"), "attach-evidence-photos-from-the-checklist");
  assert.equal(slugify("  Crème Brûlée  "), "creme-brulee");
  assert.equal(slugify("***"), "item");
  assert.equal(slugify("a".repeat(80)).length, 60);
});

test("refs pad to four digits and round-trip", () => {
  assert.equal(formatRef(1), "ENH-0001");
  assert.equal(formatRef(42), "ENH-0042");
  assert.equal(formatRef(12345), "ENH-12345");
  assert.equal(parseRefSequence("ENH-0007"), 7);
  assert.equal(parseRefSequence("ENH-7"), 7);
  assert.equal(parseRefSequence("NOPE"), null);
});

test("handover filenames match the workflow glob and carry the record suffix", () => {
  const name = handoverFileName("ENH-0003", "Bulk-assign auditors across a quarter", "9f1c2b7e-aaaa-bbbb");
  assert.match(name, HANDOVER_FILE_PATTERN);
  assert.match(name, /^ENH-0003-bulk-assign-auditors-across-a-quarter-9f1c2b7e/);
  assert.ok(looksLikeHandoverDoc(`docs/enhancements/${name}`));
  assert.equal(refFromPath(`docs/enhancements/${name}`), "ENH-0003");
  assert.equal(vaultFileName("ENH-0003", "Bulk assign"), "ENH-0003-bulk-assign.md");
  assert.ok(!looksLikeHandoverDoc("docs/enhancements/README.md"));
  assert.ok(isArchivedDocPath("lib/future-enhancements/archived/ENH-0001-x.md"));
  assert.ok(isArchivedDocPath("lib/future-enhancements/archive/ENH-0001-x.md"));
  assert.ok(!isArchivedDocPath("lib/future-enhancements/ENH-0001-x.md"));
});

test("frontmatter quotes dangerous scalars and parses back", () => {
  assert.equal(yamlScalar("plain words"), "plain words");
  assert.equal(yamlScalar("has: colon"), '"has: colon"');
  assert.equal(yamlScalar('quote "inside"'), '"quote \\"inside\\""');
  assert.equal(yamlScalar(""), '""');
  // Numeric-looking strings are quoted so they never become YAML numbers;
  // buildFrontmatter emits genuine numbers unquoted (see below).
  assert.equal(yamlScalar(42), '"42"');
  assert.equal(yamlScalar("true"), '"true"');

  const block = buildFrontmatter({
    ref: "ENH-0001",
    title: "Trend: readiness #1",
    status: "Building",
    votes: 3,
    app_sections: ["sec.kpi-tiles", "tab.overview"],
    ai_fields: [],
  });
  assert.ok(block.startsWith("---\n") && block.endsWith("\n---"));

  const parsed = parseFrontmatter(`${block}\n\n# body`);
  assert.equal(parsed.ref, "ENH-0001");
  assert.equal(parsed.title, "Trend: readiness #1");
  assert.equal(parsed.status, "Building");
  assert.equal(parsed.votes, "3");
  assert.deepEqual(parsed.app_sections, ["sec.kpi-tiles", "tab.overview"]);
  assert.deepEqual(parsed.ai_fields, []);
});

test("lifecycle helpers guard the terminal states", () => {
  assert.ok(statusRank("Built") > statusRank("Building"));
  assert.equal(statusRank("Archived"), -1);
  assert.ok(isArchivable("Building") && isArchivable("Built"));
  assert.ok(!isArchivable("Submitted"));

  // Archived never overwrites a human rejection.
  assert.equal(canApplyDocStatus("Rejected", "Archived"), false);
  assert.equal(canApplyDocStatus("Building", "Archived"), true);

  // A Built doc promotes exactly the records in Building — never skips stages.
  assert.equal(canApplyDocStatus("Submitted", "Built"), false);
  assert.equal(canApplyDocStatus("Reviewing", "Built"), false);
  assert.equal(canApplyDocStatus("Building", "Built"), true);
  assert.equal(canApplyDocStatus("Built", "Built"), false);
  assert.equal(canApplyDocStatus("Archived", "Built"), false);
  assert.equal(canApplyDocStatus("Rejected", "Built"), false);
});

test("session tokens round-trip and are self-contained", () => {
  const now = 1_700_000_000;
  const payload: SessionPayload = { sub: "person-1", sid: "session-1", iat: now, exp: now + 600 };
  const token = signSession(payload, "unit-test-secret-value");
  const decoded = verifySession(token, now + 1, "unit-test-secret-value");
  assert.deepEqual(decoded, payload);
  // Same token verifies with no server state at all (serverless-safe).
  assert.equal(verifySession(token, now + 599, "unit-test-secret-value")?.sub, "person-1");
});

test("tampered or expired session tokens are rejected", () => {
  const now = 1_700_000_000;
  const secret = "unit-test-secret-value";
  const token = signSession({ sub: "person-1", sid: "session-1", iat: now, exp: now + 600 }, secret);
  const [body, signature] = token.split(".");

  // Swapped payload, original signature.
  const forged = `${Buffer.from(JSON.stringify({ sub: "admin", sid: "session-1", iat: now, exp: now + 600 })).toString("base64url")}.${signature}`;
  assert.equal(verifySession(forged, now + 1, secret), null);

  // Flipped signature byte.
  const badSig = `${body}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifySession(badSig, now + 1, secret), null);

  // Wrong secret.
  assert.equal(verifySession(token, now + 1, "another-secret-entirely"), null);

  // Expired.
  assert.equal(verifySession(token, now + 601, secret), null);

  // Garbage.
  assert.equal(verifySession("not-a-token", now, secret), null);
  assert.equal(verifySession("", now, secret), null);
  assert.equal(verifySession(null, now, secret), null);
});

test("handover markers and PR body lines parse in the workflow's format", () => {
  const marker = handoverMarker("docs/enhancements/ENH-0001-x.md");
  assert.equal(marker, "<!-- handover: docs/enhancements/ENH-0001-x.md -->");
  assert.equal(readHandoverMarker(`Some issue body\n${marker}\ntail`), "docs/enhancements/ENH-0001-x.md");
  assert.equal(readHandoverMarker("no marker here"), null);

  const body = [
    "## Summary",
    "Implements the trend tiles.",
    "",
    "Handover: docs/enhancements/ENH-0001-trend.md",
    "- Handover: `docs/enhancements/ENH-0002-photos.md`, docs/enhancements/ENH-0003-bulk.md",
    "Not a handover: docs/other.md",
  ].join("\n");
  assert.deepEqual(parseHandoverLines(body), [
    "docs/enhancements/ENH-0001-trend.md",
    "docs/enhancements/ENH-0002-photos.md",
    "docs/enhancements/ENH-0003-bulk.md",
  ]);
});
