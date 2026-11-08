/**
 * The drafting engine. Deterministic, local, tenant-grounded — and never one
 * fixed answer per field.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAFT_FIELDS,
  MIN_DRAFT_CHARS,
  contentWords,
  detectArea,
  draftAll,
  draftField,
  normaliseKeywordMap,
  rankSections,
  sectionIdsFor,
  subjectPhrase,
  type DraftTenant,
} from "../lib/ai.ts";
import { NORTHWIND_TENANT, QA_TENANT, type SeedTenant } from "../lib/seed-data.ts";

function toDraftTenant(seed: SeedTenant): DraftTenant {
  return {
    slug: seed.slug,
    name: seed.name,
    areas: seed.areas,
    keywordMap: seed.keywordMap,
    catalogue: seed.catalogue.map((entry) => ({ ...entry })),
  };
}

const QA = toDraftTenant(QA_TENANT);
const NORTHWIND = toDraftTenant(NORTHWIND_TENANT);

const QA_TEXT =
  "We need a quarter-over-quarter audit readiness trend on the KPI tiles so regional managers can see whether evidence capture is improving without exporting the report every month.";
const NORTHWIND_TEXT =
  "Customers want the cart to remember their last shipping address at checkout so repeat orders take two clicks and the payment step stays untouched.";

test("drafting is deterministic for identical input", () => {
  const first = draftAll(QA_TEXT, QA);
  const second = draftAll(QA_TEXT, QA);
  assert.deepEqual(first.fields, second.fields);
  assert.equal(first.area, second.area);

  assert.deepEqual(draftField(QA_TEXT, QA, "title", 0), draftField(QA_TEXT, QA, "title", 0));
  // A different seed must be able to produce different wording somewhere.
  assert.notDeepEqual(draftField(QA_TEXT, QA, "requirements", 0), draftField(QA_TEXT, QA, "requirements", 3));
});

test("all nine fields offer between two and three options", () => {
  const result = draftAll(QA_TEXT, QA);
  assert.equal(result.drafted, true);
  assert.deepEqual(Object.keys(result.fields).sort(), [...DRAFT_FIELDS].sort());
  for (const field of DRAFT_FIELDS) {
    const options = result.fields[field];
    assert.ok(options.length >= 2, `${field} offered ${options.length} option(s)`);
    assert.ok(options.length <= 3, `${field} offered ${options.length} options`);
    for (const option of options) assert.ok(option.trim().length > 0, `${field} had a blank option`);
    assert.equal(new Set(options).size, options.length, `${field} repeated an option`);
  }
});

test("fewer than twelve characters drafts nothing", () => {
  const short = "add a chart";
  assert.ok(short.length < MIN_DRAFT_CHARS);
  const result = draftAll(short, QA);
  assert.equal(result.drafted, false);
  for (const field of DRAFT_FIELDS) {
    assert.deepEqual(result.fields[field], [], `${field} drafted from a too-short input`);
    assert.deepEqual(draftField(short, QA, field), []);
  }
  // Whitespace padding does not count.
  assert.equal(draftAll("      ", QA).drafted, false);
  // Exactly twelve characters is enough.
  const twelve = "add a chart1";
  assert.equal(twelve.length, MIN_DRAFT_CHARS);
  assert.equal(draftAll(twelve, QA).drafted, true);
});

test("tenant vocabularies never leak across tenants", () => {
  const qaResult = draftAll(QA_TEXT, QA);
  const northwindResult = draftAll(NORTHWIND_TEXT, NORTHWIND);

  const flatten = (fields: Record<string, string[]>) =>
    Object.values(fields).flat().join("\n").toLowerCase();

  const qaText = flatten(qaResult.fields);
  const northwindText = flatten(northwindResult.fields);

  // Grounded in their own tenant's name and nothing else.
  assert.ok(qaText.includes("hfm qa activity calendar"), "QA draft should mention its own app");
  assert.ok(!qaText.includes("northwind"), "QA draft leaked the other tenant's name");
  assert.ok(!qaText.includes("checkout"), "QA draft leaked the other tenant's vocabulary");

  assert.ok(northwindText.includes("northwind customer portal"));
  assert.ok(!northwindText.includes("hfm"));
  assert.ok(!northwindText.includes("audit readiness"));
  assert.ok(!northwindText.includes("qa-calendar"));

  // Sections always come from the tenant's own catalogue.
  const qaIds = new Set(QA.catalogue.map((entry) => entry.id));
  const northwindIds = new Set(NORTHWIND.catalogue.map((entry) => entry.id));
  for (const option of qaResult.fields.sections) {
    for (const id of sectionIdsFor(option, QA)) assert.ok(qaIds.has(id), `unknown QA section ${id}`);
    for (const id of option.split(/[,\s]+/).filter(Boolean)) {
      assert.ok(!northwindIds.has(id) || qaIds.has(id), `QA proposed a Northwind-only ID ${id}`);
    }
  }
  for (const option of northwindResult.fields.sections) {
    for (const id of option.split(/[,\s]+/).filter(Boolean)) {
      assert.ok(northwindIds.has(id), `Northwind proposed an unknown section ${id}`);
      assert.ok(!qaIds.has(id), `Northwind proposed a QA-only section ${id}`);
    }
  }

  // Keyword-driven area detection follows each tenant's map.
  assert.equal(detectArea(QA_TEXT, QA).area, "Reporting");
  assert.equal(detectArea(NORTHWIND_TEXT, NORTHWIND).area, "Checkout");
  // A QA keyword has no meaning inside the Northwind tenant.
  assert.equal(detectArea("we need an audit calendar for auditors", NORTHWIND).area, "");
});

test("malformed stored patterns and keyword maps are ignored, never thrown", () => {
  const hostile: DraftTenant = {
    ...QA,
    keywordMap: {
      // Broken regex: must be skipped, not crash the request.
      "/[unclosed/": "Audit",
      // Valid regex still works.
      "/readiness|trend/i": "Reporting",
      // Non-string values are dropped by the normaliser.
      audit: 42 as unknown as string,
      "": "Audit",
    } as Record<string, string>,
  };

  assert.doesNotThrow(() => draftAll(QA_TEXT, hostile));
  const detection = detectArea("we need an audit readiness trend", hostile);
  assert.equal(detection.area, "Reporting");

  const normalised = normaliseKeywordMap({
    good: "Audit",
    bad: 7,
    "": "Nope",
    alsoGood: "Calendar",
  } as unknown as Record<string, string>);
  assert.deepEqual(
    normalised.map((entry) => entry.term),
    ["good", "alsogood"],
  );

  // A tenant with no catalogue at all still drafts without inventing IDs.
  const bare: DraftTenant = { ...QA, catalogue: [], keywordMap: {} };
  const result = draftAll(QA_TEXT, bare);
  assert.equal(result.drafted, true);
  for (const option of result.fields.sections) assert.equal(option, "");
});

test("ranking rewards word overlap and area matches", () => {
  const ranked = rankSections(QA_TEXT, QA, "Reporting");
  assert.ok(ranked.length > 0);
  const ids = ranked.map((entry) => entry.entry.id);
  // "readiness"/"trend" style overlap plus the Reporting area lifts the KPI tiles.
  assert.ok(ids.includes("sec.kpi-tiles"), `expected KPI tiles in ${ids.join(",")}`);
  assert.equal(ranked[0].score >= ranked[ranked.length - 1].score, true);
  // Area matches are worth +5, so every Reporting-tagged entry outranks pure overlap.
  const kpi = ranked.find((entry) => entry.entry.id === "sec.kpi-tiles");
  assert.ok(kpi && kpi.score >= 5);
});

test("imperative vocabulary is stripped so titles read like subjects", () => {
  const phrase = subjectPhrase("Please give the team a track plan forecast schedule include audit trend");
  assert.ok(!/^(please|give|track|plan|forecast|schedule|include)\b/i.test(phrase), `unexpected lead verb in "${phrase}"`);
  assert.ok(phrase.length > 0);

  // The same vocabulary is not treated as content.
  const words = contentWords("give track plan forecast schedule include the audit calendar");
  for (const verb of ["give", "track", "plan", "forecast", "schedule", "include"]) {
    assert.ok(!words.includes(verb), `${verb} should be an imperative, not content`);
  }
});

test("author words win in the handover document build", async () => {
  const { buildEnhancementMarkdown } = await import("../lib/vault.ts");
  const tenant = {
    id: "t1",
    slug: "qa-calendar",
    name: "HFM QA Activity Calendar",
    description: "",
    github_repo: "owner/repo",
    handover_dir: "lib/future-enhancements",
    areas_json: "[]",
    keyword_map_json: "{}",
    colour: "#fff",
    enabled: 1,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    areas: ["Reporting"],
    keywordMap: {},
  };

  const record = {
    id: "enh-1",
    tenant_id: "t1",
    ref: "ENH-0009",
    title: "Author-written title, not the draft",
    brief: "Author brief.",
    raw_text: "raw words",
    requirements: "- author requirement",
    impacts: "",
    expected_outcome: "",
    success_criteria: "",
    markdown: "",
    outcome: "",
    status: "Building",
    area: "Reporting",
    sections: "sec.kpi-tiles, tab.overview",
    ai_fields: JSON.stringify(["requirements"]),
    votes: 2,
    submitted_by: "author@example.com",
    github_path: "",
    handover_path: "",
    archived_at: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  const markdown = buildEnhancementMarkdown(record, tenant, { kind: "handover" });
  assert.ok(markdown.includes("# ENH-0009 — Author-written title, not the draft"));
  assert.ok(markdown.includes("- author requirement"));
  // AI fields are echoed into the frontmatter and the footer so they stay distinguishable.
  assert.match(markdown, /ai_fields:\n {2}- requirements/);
  assert.match(markdown, /_AI-drafted fields: requirements\./);
  assert.match(markdown, /status: Building/);
  assert.match(markdown, /app_sections:\n {2}- sec\.kpi-tiles\n {2}- tab\.overview/);

  // With no AI fields, the footer says so explicitly.
  const authored = buildEnhancementMarkdown({ ...record, ai_fields: "[]" }, tenant);
  assert.match(authored, /_No AI-drafted fields/);
});

test("section ids resolve only against the tenant catalogue", () => {
  const option = "sec.kpi-tiles, tab.overview, sec.not-real, tab.made-up";
  assert.deepEqual(sectionIdsFor(option, QA), ["sec.kpi-tiles", "tab.overview"]);
  assert.deepEqual(sectionIdsFor("", QA), []);
});
