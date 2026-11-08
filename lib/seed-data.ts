/**
 * Demo content for two tenants. Everything here is DATA — swapping these objects
 * for real ones is how a new app plugs in (docs/CONNECTING-AN-APP.md).
 */
import type { CatalogueEntry } from "./ai.ts";

export type SeedTenant = {
  slug: string;
  name: string;
  description: string;
  github_repo: string;
  handover_dir: string;
  areas: string[];
  keywordMap: Record<string, string>;
  colour: string;
  sort_order: number;
  catalogue: CatalogueEntry[];
  departments: string[];
};

export const QA_TENANT: SeedTenant = {
  slug: "qa-calendar",
  name: "HFM QA Activity Calendar",
  description:
    "Quality-assurance activity planning for the HFM program: audit calendar, evidence capture, and readiness tracking.",
  github_repo: "Raheelatta1984/QA-Activity-Calendar",
  handover_dir: "lib/future-enhancements",
  areas: ["Audit", "Calendar", "Evidence", "Reporting"],
  keywordMap: {
    audit: "Audit",
    auditor: "Audit",
    checklist: "Audit",
    finding: "Audit",
    "non-conformance": "Audit",
    ncr: "Audit",
    calendar: "Calendar",
    schedule: "Calendar",
    milestone: "Calendar",
    quarter: "Calendar",
    evidence: "Evidence",
    attachment: "Evidence",
    photo: "Evidence",
    document: "Evidence",
    report: "Reporting",
    dashboard: "Reporting",
    metric: "Reporting",
    export: "Reporting",
    "audit calendar": "Calendar",
    "evidence pack": "Evidence",
  },
  colour: "#5b8cff",
  sort_order: 10,
  departments: ["Quality Assurance", "Operations", "Compliance"],
  catalogue: [
    { id: "tab.overview", label: "Overview", kind: "tab", hint: "Program health tiles and next audits" },
    { id: "tab.calendar", label: "Activity Calendar", kind: "tab", hint: "Month grid of scheduled audits and milestones" },
    { id: "tab.audits", label: "Audits", kind: "tab", hint: "Audit register with status and owner" },
    { id: "tab.evidence", label: "Evidence", kind: "tab", hint: "Attachments and evidence packs per audit" },
    { id: "tab.reports", label: "Reports", kind: "tab", hint: "Exportable readiness and findings reports" },
    { id: "tab.settings", label: "Settings", kind: "tab", hint: "Sites, templates and user administration" },
    { id: "sec.audit-log", label: "Audit log", kind: "section", hint: "Chronological record of audit lifecycle events" },
    { id: "sec.audit-checklist", label: "Audit checklist", kind: "section", hint: "Per-audit question set and scoring" },
    { id: "sec.audit-findings", label: "Findings", kind: "section", hint: "Raised findings, severity and closure" },
    { id: "sec.calendar-grid", label: "Calendar grid", kind: "section", hint: "Scheduling matrix across sites and auditors" },
    { id: "sec.calendar-filters", label: "Calendar filters", kind: "section", hint: "Filter by site, auditor, quarter" },
    { id: "sec.evidence-upload", label: "Evidence upload", kind: "section", hint: "Drag-and-drop attachments with versioning" },
    { id: "sec.evidence-pack", label: "Evidence pack builder", kind: "section", hint: "Bundle evidence per audit for review" },
    { id: "sec.report-export", label: "Report export", kind: "section", hint: "PDF and CSV exports of readiness data" },
    { id: "sec.kpi-tiles", label: "KPI tiles", kind: "section", hint: "Readiness, overdue audits, open findings" },
    { id: "sec.site-register", label: "Site register", kind: "section", hint: "Sites, regions and local coordinators" },
  ],
};

export const NORTHWIND_TENANT: SeedTenant = {
  slug: "northwind",
  name: "Northwind Customer Portal",
  description:
    "Customer-facing commerce portal: catalogue browsing, orders, and account self-service for Northwind Trading.",
  github_repo: "Raheelatta1984/northwind-portal-demo",
  handover_dir: "docs/enhancements",
  areas: ["Catalogue", "Checkout", "Accounts", "Support"],
  keywordMap: {
    product: "Catalogue",
    catalogue: "Catalogue",
    inventory: "Catalogue",
    search: "Catalogue",
    filter: "Catalogue",
    cart: "Checkout",
    checkout: "Checkout",
    payment: "Checkout",
    invoice: "Checkout",
    shipping: "Checkout",
    account: "Accounts",
    profile: "Accounts",
    password: "Accounts",
    login: "Accounts",
    support: "Support",
    ticket: "Support",
    chat: "Support",
    refund: "Support",
  },
  colour: "#4fd1a5",
  sort_order: 20,
  departments: ["Merchandising", "Customer Care", "Platform"],
  catalogue: [
    { id: "tab.catalog", label: "Catalogue", kind: "tab", hint: "Product grid, search and filters" },
    { id: "tab.cart", label: "Cart & Checkout", kind: "tab", hint: "Basket, shipping and payment" },
    { id: "tab.account", label: "My Account", kind: "tab", hint: "Profile, addresses and order history" },
    { id: "tab.support", label: "Support", kind: "tab", hint: "Help centre and ticket history" },
    { id: "sec.product-list", label: "Product list", kind: "section", hint: "Grid of products with pagination" },
    { id: "sec.product-detail", label: "Product detail", kind: "section", hint: "Gallery, variants and stock state" },
    { id: "sec.search-bar", label: "Search bar", kind: "section", hint: "Query input with suggestions" },
    { id: "sec.cart-summary", label: "Cart summary", kind: "section", hint: "Line items, totals and vouchers" },
    { id: "sec.checkout-payment", label: "Payment step", kind: "section", hint: "Card capture and confirmation" },
    { id: "sec.order-history", label: "Order history", kind: "section", hint: "Past orders with tracking links" },
    { id: "sec.account-profile", label: "Account profile", kind: "section", hint: "Name, email and preferences" },
    { id: "sec.support-tickets", label: "Support tickets", kind: "section", hint: "Open tickets and replies" },
  ],
};

export const SEED_TENANTS: SeedTenant[] = [QA_TENANT, NORTHWIND_TENANT];

export type SeedPerson = {
  key: string;
  email: string;
  name: string;
  role: "viewer" | "editor" | "manager" | "exec" | "admin";
  tenant: "qa-calendar" | "northwind" | null;
};

/** Six demo people, all with password `demo1234`. */
export const SEED_PEOPLE: SeedPerson[] = [
  { key: "amara", email: "amara.okafor@hub.demo", name: "Amara Okafor", role: "admin", tenant: null },
  { key: "priya", email: "priya.raman@hub.demo", name: "Priya Raman", role: "exec", tenant: null },
  { key: "lachlan", email: "lachlan.wu@qa.demo", name: "Lachlan Wu", role: "manager", tenant: "qa-calendar" },
  { key: "sofia", email: "sofia.marino@qa.demo", name: "Sofia Marino", role: "editor", tenant: "qa-calendar" },
  { key: "hana", email: "hana.sato@qa.demo", name: "Hana Sato", role: "viewer", tenant: "qa-calendar" },
  { key: "noah", email: "noah.bennett@northwind.demo", name: "Noah Bennett", role: "editor", tenant: "northwind" },
];

export type SeedProposal = {
  key: string;
  tenant: "qa-calendar" | "northwind";
  status: "Submitted" | "Reviewing" | "Accepted" | "Building" | "Built" | "Archived" | "Rejected";
  title: string;
  brief: string;
  rawText: string;
  requirements: string;
  impacts: string;
  expectedOutcome: string;
  successCriteria: string;
  narrative: string;
  outcome: string;
  area: string;
  sections: string[];
  aiFields: string[];
  votes: number;
  submittedBy: string;
  createdOffsetDays: number;
  handover?: { path: string };
  archived?: boolean;
};

export const SEED_PROPOSALS: SeedProposal[] = [
  {
    key: "enh-seed-0001",
    tenant: "qa-calendar",
    status: "Building",
    title: "Add quarter-over-quarter audit readiness trend",
    brief:
      "The readiness KPI tiles only show the current quarter, so trend questions are answered with a manual spreadsheet export.",
    rawText:
      "We need a ready-to-use trend for audit readiness per quarter so regional managers can see whether evidence capture is improving without exporting the report every month.",
    requirements:
      "- Show readiness % for the last four quarters on the KPI tiles\n- Let a site filter narrow the trend\n- Keep the export unchanged for auditors",
    impacts: "Touches the KPI tiles and report export; stored audit records are unchanged.",
    expectedOutcome: "Regional managers answer trend questions in the portal instead of in a spreadsheet.",
    successCriteria:
      "1. Trend renders for four quarters.\n2. Site filter changes the series.\n3. Existing export output is byte-identical.",
    narrative:
      "## Quarter-over-quarter readiness trend\n\nThe KPI tiles currently answer \"how are we going this quarter?\" and nothing else. Managers export the report monthly to build the trend by hand.\n\n### Requirements\n\n- Four-quarter trend on the KPI tiles\n- Site filter narrows the series\n- Export output stays identical",
    outcome: "Walk into the quarterly review with the trend already on screen.",
    area: "Reporting",
    sections: ["sec.kpi-tiles", "sec.report-export", "tab.overview"],
    aiFields: ["title", "brief", "requirements"],
    votes: 3,
    submittedBy: "sofia.marino@qa.demo",
    createdOffsetDays: 18,
    handover: { path: "lib/future-enhancements/ENH-0001-add-quarter-over-quarter-audit-readiness-trend-enh-seed-0001.md" },
  },
  {
    key: "enh-seed-0002",
    tenant: "qa-calendar",
    status: "Archived",
    title: "Attach evidence photos directly from the audit checklist",
    brief:
      "Auditors photograph evidence on a phone, then re-upload it later from a laptop. Half the packs arrive without the field photos.",
    rawText:
      "Let auditors capture evidence photos straight from the checklist on a phone and attach them to the audit without going back to a laptop.",
    requirements:
      "- Camera capture from the checklist screen\n- Downscale before upload to keep packs small\n- Show a thumbnail with the checklist line",
    impacts: "Evidence upload and audit checklist sections; no change to existing attachment storage.",
    expectedOutcome: "Evidence packs arrive complete, captured at the point of the audit.",
    successCriteria:
      "1. A photo can be taken and attached in under 20 seconds.\n2. Files stay under 2 MB after downscaling.\n3. Thumbnails appear beside the checklist line.",
    narrative:
      "## Evidence capture in the field\n\nAuditors work on a phone but evidence is uploaded from a laptop afterwards.\n\n### Requirements\n\n- Camera capture from the checklist\n- Downscale to under 2 MB\n- Thumbnail beside the checklist line",
    outcome: "Fewer findings closed late because evidence was missing.",
    area: "Evidence",
    sections: ["sec.evidence-upload", "sec.audit-checklist", "tab.evidence"],
    aiFields: ["brief", "successCriteria"],
    votes: 4,
    submittedBy: "lachlan.wu@qa.demo",
    createdOffsetDays: 64,
    handover: { path: "lib/future-enhancements/archived/ENH-0002-attach-evidence-photos-directly-from-the-audit-checklist-enh-seed-0002.md" },
    archived: true,
  },
  {
    key: "enh-seed-0003",
    tenant: "qa-calendar",
    status: "Reviewing",
    title: "Bulk-assign auditors across a quarter of scheduled audits",
    brief: "Assigning auditors one audit at a time makes the start-of-quarter planning week the busiest week of the quarter.",
    rawText:
      "Give the planning team a way to assign one auditor to many scheduled audits at once, filtered by site and quarter, instead of opening each calendar entry.",
    requirements:
      "- Multi-select rows in the calendar grid\n- Assign an auditor to the selection in one action\n- Warn when an auditor already has a clash that day",
    impacts: "Calendar grid and calendar filters; auditor records unchanged.",
    expectedOutcome: "Quarter planning happens in one sitting instead of one week.",
    successCriteria:
      "1. 20 audits are assigned in a single action.\n2. Clash warnings appear before saving.\n3. Audit log records the bulk change.",
    narrative:
      "## Bulk auditor assignment\n\nStart-of-quarter planning is done one audit at a time.\n\n### Requirements\n\n- Multi-select in the calendar grid\n- Assign in one action\n- Warn on same-day clashes",
    outcome: "Planning week becomes planning hour.",
    area: "Calendar",
    sections: ["sec.calendar-grid", "sec.calendar-filters", "tab.calendar"],
    aiFields: ["title"],
    votes: 1,
    submittedBy: "sofia.marino@qa.demo",
    createdOffsetDays: 6,
  },
  {
    key: "enh-seed-0004",
    tenant: "northwind",
    status: "Submitted",
    title: "Remember the last used shipping address at checkout",
    brief: "Repeat customers re-enter the same address on every order, which shows up as abandoned carts in the funnel report.",
    rawText:
      "Customers want the cart to remember their last shipping address so repeat orders take two clicks instead of twelve.",
    requirements:
      "- Pre-select the most recent shipping address\n- Allow switching to any saved address\n- Never pre-fill payment details",
    impacts: "Cart summary and payment step; address records unchanged.",
    expectedOutcome: "Repeat orders complete faster and abandonment drops.",
    successCriteria:
      "1. Returning customers see their last address selected.\n2. Switching addresses still works.\n3. No payment data is cached.",
    narrative:
      "## Remember the last shipping address\n\nRepeat customers retype the same address on every order.\n\n### Requirements\n\n- Pre-select the most recent address\n- Allow switching\n- Never cache payment details",
    outcome: "Fewer abandoned repeat orders.",
    area: "Checkout",
    sections: ["sec.cart-summary", "sec.checkout-payment"],
    aiFields: [],
    votes: 2,
    submittedBy: "noah.bennett@northwind.demo",
    createdOffsetDays: 2,
  },
];
