/**
 * lib/ai.ts — the "Studio" drafting engine.
 *
 * Design rules (see docs/DECISIONS.md):
 *  • Deterministic and local. No network call ever leaves this module, so proposal
 *    text cannot leak to a third-party model. Same input ⇒ same options.
 *  • Options, not answers. Every field offers 2–3 candidate drafts; a human picks.
 *  • Grounded only in the tenant's own areas, keyword map and stable-ID catalogue.
 *    A draft can never mention another tenant's vocabulary.
 */

export type CatalogueEntry = {
  id: string;
  label: string;
  kind?: string;
  hint?: string;
};

export type DraftTenant = {
  slug: string;
  name: string;
  areas: string[];
  keywordMap: Record<string, string>;
  catalogue: CatalogueEntry[];
};

export const DRAFT_FIELDS = [
  "title",
  "brief",
  "requirements",
  "impacts",
  "expectedOutcome",
  "successCriteria",
  "sections",
  "markdown",
  "outcome",
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

export type DraftOptions = Record<DraftField, string[]>;

export type DraftResult = {
  fields: DraftOptions;
  area: string;
  keywords: string[];
  /** False when the raw text is shorter than MIN_DRAFT_CHARS. */
  drafted: boolean;
};

export const MIN_DRAFT_CHARS = 12;

const IMPERATIVES = new Set([
  "add",
  "allow",
  "build",
  "capture",
  "change",
  "create",
  "display",
  "enable",
  "expose",
  "fill",
  "filter",
  "forecast",
  "generate",
  "give",
  "include",
  "integrate",
  "keep",
  "let",
  "log",
  "make",
  "move",
  "need",
  "plan",
  "provide",
  "record",
  "remove",
  "rename",
  "replace",
  "require",
  "schedule",
  "see",
  "send",
  "show",
  "sort",
  "support",
  "sync",
  "track",
  "use",
  "want",
  "would",
  "should",
  "could",
  "must",
  "needs",
  "improve",
  "surface",
  "link",
  "alert",
  "notify",
  "export",
  "import",
  "select",
  "mark",
  "approve",
  "publish",
]);

const MODALS = ["should", "must", "will", "can", "needs to", "would"];

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","been","being","but","by","can","could","did","do","does",
  "for","from","had","has","have","how","i","if","in","into","is","it","its","just","like","me",
  "more","most","my","need","needs","of","on","or","our","out","over","please","should","so",
  "some","that","the","their","them","then","there","these","they","this","those","to","too",
  "up","us","use","very","was","we","were","what","when","where","which","while","who","why",
  "will","with","would","you","your","also","get","got","make","let","able",
]);

/* --------------------------------------------------------------------- hashing */

/** Stable 32-bit hash (FNV-1a) — determinism across processes and restarts. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/* ---------------------------------------------------------------------- text */

export function sentences(text: string): string[] {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\s*;\s*|\s*\n\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function contentWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words(text)) {
    if (word.length < 3) continue;
    if (STOPWORDS.has(word) || IMPERATIVES.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Strips leading politeness/imperatives so the subject reads like a noun phrase. */
export function subjectPhrase(text: string): string {
  const first = sentences(text)[0] ?? text ?? "";
  const cleaned = first
    .replace(/^(please\s+|kindly\s+|ideally\s+)/i, "")
    .replace(
      /^(we\s+(need|want|would\s+like)\s+(to\s+)?|i\s+(need|want)\s+to\s+|it\s+would\s+be\s+(great|good|nice)\s+(if|to)\s+|can\s+we\s+|could\s+we\s+|there\s+should\s+be\s+)/i,
      "",
    )
    .replace(/[.!?]+$/, "")
    .trim();

  // Drop any number of stacked leading imperatives ("give track plan …").
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && IMPERATIVES.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }
  let phrase = tokens.join(" ").trim();
  if (phrase.length < 3) phrase = (sentences(text)[0] ?? "the requested change").trim();
  return capitalise(clampWords(phrase, 14));
}

export function capitalise(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function clampWords(text: string, max: number): string {
  const parts = (text ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= max) return parts.join(" ");
  return `${parts.slice(0, max).join(" ")}`;
}

function lowerFirst(text: string): string {
  if (!text) return text;
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/* -------------------------------------------------------------- tenant grounding */

export type AreaDetection = { area: string; keywords: string[] };

/**
 * Keyword map is user-supplied data: entries that are not strings, or that carry a
 * broken /regex/ pattern, are ignored instead of throwing.
 */
export function normaliseKeywordMap(raw: unknown): Array<{ term: string; area: string }> {
  const out: Array<{ term: string; area: string }> = [];
  if (!raw || typeof raw !== "object") return out;
  for (const [term, area] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof term !== "string" || !term.trim()) continue;
    if (typeof area !== "string" || !area.trim()) continue;
    out.push({ term: term.trim().toLowerCase(), area: area.trim() });
  }
  return out;
}

export function detectArea(rawText: string, tenant: DraftTenant): AreaDetection {
  const text = ` ${(rawText ?? "").toLowerCase()} `;
  const hits = new Map<string, string[]>();
  for (const { term, area } of normaliseKeywordMap(tenant.keywordMap)) {
    const regexTerm = /^\/(.+)\/([a-z]*)$/i.exec(term);
    const matched = regexTerm
      ? safeRegexTest(regexTerm[1], regexTerm[2] || "i", text)
      : term.length > 0 && text.includes(term);
    if (!matched) continue;
    const list = hits.get(area) ?? [];
    list.push(term);
    hits.set(area, list);
  }
  if (hits.size > 0) {
    const ranked = [...hits.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    return { area: ranked[0][0], keywords: [...new Set(ranked[0][1])].slice(0, 4) };
  }
  // Fall back to a literal area-name mention.
  for (const area of tenant.areas ?? []) {
    if (typeof area === "string" && area.trim() && text.includes(area.toLowerCase())) {
      return { area, keywords: [] };
    }
  }
  return { area: "", keywords: [] };
}

/** Malformed patterns (`/[unclosed/`) return false instead of throwing. */
function safeRegexTest(pattern: string, flags: string, text: string): boolean {
  try {
    return new RegExp(pattern, flags.replace(/[gy]/g, "")).test(text);
  } catch {
    return false;
  }
}

export type ScoredSection = { entry: CatalogueEntry; score: number; reason: string };

/**
 * Ranks catalogue entries: +2 per overlapping word, +5 when the entry matches the
 * detected area. Entries are the app's own stable IDs — the hub never invents IDs.
 */
export function rankSections(rawText: string, tenant: DraftTenant, area = ""): ScoredSection[] {
  const textWords = new Set(words(rawText));
  const scored: ScoredSection[] = [];
  for (const entry of tenant.catalogue ?? []) {
    if (!entry || typeof entry.id !== "string" || !entry.id.trim()) continue;
    const labelWords = [...new Set(words(`${entry.label ?? ""} ${entry.hint ?? ""}`))].filter(
      (w) => w.length >= 3 && !STOPWORDS.has(w),
    );
    let score = 0;
    let overlap = 0;
    for (const word of labelWords) {
      if (textWords.has(word)) {
        score += 2;
        overlap += 1;
      }
    }
    let areaMatch = false;
    if (area && entryMatchesArea(entry, area)) {
      score += 5;
      areaMatch = true;
    }
    if (score <= 0) continue;
    scored.push({
      entry,
      score,
      reason: areaMatch ? `area match (${area}) + ${overlap} word overlap` : `${overlap} word overlap`,
    });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
}

function entryMatchesArea(entry: CatalogueEntry, area: string): boolean {
  const haystack = `${entry.id} ${entry.label ?? ""} ${entry.hint ?? ""}`.toLowerCase();
  const needle = area.toLowerCase();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  // Tolerate hyphen/underscore variants: "QA Activity" -> "qa-activity"
  const normalisedNeedle = needle.replace(/[^a-z0-9]+/g, "-");
  const normalisedStack = haystack.replace(/[^a-z0-9]+/g, "-");
  return normalisedNeedle.length > 2 && normalisedStack.includes(normalisedNeedle);
}

/* ------------------------------------------------------------------- drafting */

type Ctx = {
  raw: string;
  tenant: DraftTenant;
  area: string;
  keywords: string[];
  subject: string;
  phrases: string[];
  sections: ScoredSection[];
  hub: string; // "the <tenant name>" — this tenant's own words, nothing else
};

function buildCtx(raw: string, tenant: DraftTenant): Ctx {
  const detection = detectArea(raw, tenant);
  return {
    raw,
    tenant,
    area: detection.area,
    keywords: detection.keywords,
    subject: subjectPhrase(raw),
    phrases: contentWords(raw).slice(0, 6),
    sections: rankSections(raw, tenant, detection.area),
    hub: tenant.name ? `the ${tenant.name}` : "this application",
  };
}

function pick<T>(options: T[], index: number): T {
  return options[((index % options.length) + options.length) % options.length];
}

function topic(ctx: Ctx): string {
  const phrase = ctx.phrases.slice(0, 3).join(" ");
  return phrase || lowerFirst(ctx.subject);
}

function sectionDetail(ctx: Ctx): string {
  const top = ctx.sections.slice(0, 3).map((s) => s.entry.label ?? s.entry.id);
  if (top.length === 0) return "the affected screens";
  if (top.length === 1) return top[0];
  return `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
}

function areaPhrase(ctx: Ctx): string {
  return ctx.area ? `the ${ctx.area} area` : "the affected area";
}

function requirementBullets(ctx: Ctx, variant: number): string {
  const source = ctx.raw.length > 60 ? sentences(ctx.raw).slice(0, 3) : [ctx.raw];
  const base = source.map((sentence) => `- ${capitalise(clampWords(sentence.replace(/[.!?]+$/, ""), 22))}`).join("\n");
  const extras = [
    `- Show the change on ${sectionDetail(ctx)} without altering existing records`,
    `- Validate input and report errors inline instead of failing silently`,
    `- Record an audit event whenever ${topic(ctx)} changes`,
    `- Keep existing ${areaPhrase(ctx)} permissions unchanged`,
    `- Make the result visible immediately after save (no manual refresh)`,
    `- Cover the new path with an automated check before release`,
  ];
  const take = 2 + (variant % 2);
  const chosen: string[] = [];
  for (let i = 0; i < take; i += 1) {
    chosen.push(pick(extras, variant * 2 + i));
  }
  return [...new Set(chosen)].length === chosen.length ? `${base}\n${chosen.join("\n")}` : base;
}

const IMPACT_OPTIONS = [
  (ctx: Ctx) => `Touches ${sectionDetail(ctx)}; existing records keep their current IDs.`,
  (ctx: Ctx) => `Additive change in ${areaPhrase(ctx)} — no schema-breaking edits for current data.`,
  (ctx: Ctx) => `Dependent on the ${areaPhrase(ctx)} data model; downstream exports are unaffected.`,
  (ctx: Ctx) => `Presentation and validation only; stored records and URLs stay stable.`,
];

const OUTCOME_OPTIONS = [
  (ctx: Ctx) => `${capitalise(topic(ctx))} becomes self-service instead of a manual follow-up.`,
  (ctx: Ctx) => `The team stops re-entering ${topic(ctx)} by hand and the record becomes trustworthy.`,
  (ctx: Ctx) => `${capitalise(areaPhrase(ctx))} answers this question in one place, at a glance.`,
  (ctx: Ctx) => `Less double handling: ${topic(ctx)} is captured once and reused everywhere.`,
];

const SUCCESS_OPTIONS = [
  (ctx: Ctx) =>
    `1. A user can complete ${topic(ctx)} unaided.\n2. ${capitalise(sectionDetail(ctx))} reflect the change after a reload.\n3. No regression in existing ${areaPhrase(ctx)} flows.`,
  (ctx: Ctx) =>
    `1. Time to complete ${topic(ctx)} drops measurably.\n2. Data entered once appears everywhere it is needed.\n3. Support questions about this step stop recurring.`,
  (ctx: Ctx) =>
    `1. The new path is exercised by an automated test.\n2. An audit trail exists for every change.\n3. Stakeholders sign off the wording and layout.`,
  (ctx: Ctx) =>
    `1. ${capitalise(sectionDetail(ctx))} show the new state within one refresh.\n2. Existing records are untouched.\n3. The change is documented in the handover.`,
];

const TITLE_VERBS = ["Add", "Surface", "Track", "Improve", "Automate", "Standardise"];

const BRIEF_OPENERS = [
  (ctx: Ctx) => `Today ${topic(ctx)} is handled outside ${ctx.hub}.`,
  (ctx: Ctx) => `The request asks for ${lowerFirst(clampWords(ctx.subject, 12))}.`,
  (ctx: Ctx) => `Right now there is no single place in ${ctx.hub} for ${topic(ctx)}.`,
  (ctx: Ctx) => `This is a recurring manual step rather than a deliberate ${areaPhrase(ctx)} feature.`,
];

const BRIEF_BODIES = [
  (ctx: Ctx) => `Give the team a first-class way to do it on ${sectionDetail(ctx)}, so the result is recorded rather than remembered.`,
  (ctx: Ctx) => `Track it in ${sectionDetail(ctx)} and keep the change scoped to ${areaPhrase(ctx)}.`,
  (ctx: Ctx) => `Add a deliberate path for it in ${areaPhrase(ctx)}, following the conventions the rest of ${ctx.hub} already uses.`,
  (ctx: Ctx) => `Make ${sectionDetail(ctx)} the source of truth for it so nothing has to be reconstructed later.`,
];

type Gen = (ctx: Ctx, variant: number) => string;

/** Each generator is a family of phrasings; `draftField` keeps distinct ones. */
const GENERATORS: Record<Exclude<DraftField, "sections">, Gen> = {
  title: (ctx, variant) => {
    const verb = pick(TITLE_VERBS, variant);
    const suffix =
      variant % 3 === 0 ? "" : variant % 3 === 1 ? (ctx.area ? ` (${ctx.area})` : " for the team") : ` on ${sectionDetail(ctx)}`;
    return `${verb} ${lowerFirst(clampWords(ctx.subject, 9))}${suffix}`;
  },
  brief: (ctx, variant) =>
    `${pick(BRIEF_OPENERS, variant)(ctx)} ${pick(BRIEF_BODIES, Math.floor(variant / 2) + variant)(ctx)}`,
  requirements: (ctx, variant) => requirementBullets(ctx, variant),
  impacts: (ctx, variant) => pick(IMPACT_OPTIONS, variant)(ctx),
  expectedOutcome: (ctx, variant) => pick(OUTCOME_OPTIONS, variant)(ctx),
  successCriteria: (ctx, variant) => pick(SUCCESS_OPTIONS, variant)(ctx),
  markdown: (ctx, variant) =>
    [
      `## ${capitalise(clampWords(ctx.subject, 12))}`,
      "",
      GENERATORS.brief(ctx, variant),
      "",
      "### Requirements",
      requirementBullets(ctx, variant),
      "",
      "### Notes",
      pick(IMPACT_OPTIONS, variant + 1)(ctx),
      "",
      `_Drafted against ${ctx.hub}${ctx.area ? ` — ${ctx.area}` : ""}._`,
    ].join("\n"),
  outcome: (ctx, variant) => pick(OUTCOME_OPTIONS, variant + 1)(ctx),
};

function sectionsOption(ctx: Ctx, variant: number): string {
  if (ctx.sections.length === 0) {
    // Nothing scores: fall back to the tenant's own first entries, never invented IDs.
    const entries = (ctx.tenant.catalogue ?? []).filter((entry) => entry && typeof entry.id === "string");
    const size = 1 + (variant % 3);
    return entries.slice(variant % Math.max(1, entries.length), (variant % Math.max(1, entries.length)) + size).map((e) => e.id).join(", ");
  }
  const size = Math.min(ctx.sections.length, 1 + (variant % 3));
  return ctx.sections.slice(0, size).map((s) => s.entry.id).join(", ");
}

/** How many candidates a field should offer: always 2 or 3, never 1. */
export function optionTarget(raw: string, field: DraftField, tenant: DraftTenant, seed = 0): number {
  return 2 + (stableHash(`${tenant.slug}|${field}|${raw}|${seed}`) % 2);
}

/** Drafts 2–3 distinct candidate options for one field. Deterministic per seed. */
export function draftField(rawText: string, tenant: DraftTenant, field: DraftField, seed = 0): string[] {
  const raw = (rawText ?? "").trim();
  if (raw.length < MIN_DRAFT_CHARS) return [];
  const ctx = buildCtx(raw, tenant);
  const target = optionTarget(raw, field, tenant, seed);
  const offset = stableHash(`${tenant.slug}|${field}|${raw}|${seed}`) % 5;
  const options: string[] = [];
  for (let attempt = 0; attempt < 12 && options.length < target; attempt += 1) {
    const variant = offset + attempt;
    const value =
      field === "sections" ? sectionsOption(ctx, variant) : GENERATORS[field](ctx, variant);
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (options.includes(trimmed)) continue;
    options.push(trimmed);
  }
  return options;
}

/** Drafts every field at once (used by the debounced live drafting + "Fill all"). */
export function draftAll(rawText: string, tenant: DraftTenant, seed = 0): DraftResult {
  const raw = (rawText ?? "").trim();
  const detection = detectArea(raw, tenant);
  if (raw.length < MIN_DRAFT_CHARS) {
    const empty = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, [] as string[]])) as DraftOptions;
    return { fields: empty, area: detection.area, keywords: detection.keywords, drafted: false };
  }
  const fields = Object.fromEntries(
    DRAFT_FIELDS.map((field) => [field, draftField(raw, tenant, field, seed)]),
  ) as DraftOptions;
  return { fields, area: detection.area, keywords: detection.keywords, drafted: true };
}

/** Splits a sections draft ("sec.a, sec.b") into ids that exist in the catalogue. */
export function sectionIdsFor(option: string, tenant: DraftTenant): string[] {
  const known = new Set((tenant.catalogue ?? []).map((e) => e.id));
  return option
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && known.has(s));
}
