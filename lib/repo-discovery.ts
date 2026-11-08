/**
 * Explains a repository list instead of just rendering it.
 *
 * The failure this exists for is subtle and was reported twice: an operator with twenty
 * repositories saw **one** project on `/tenants` and reasonably concluded the hub was
 * broken. Nothing was broken — the token authenticated fine and listed exactly what it was
 * allowed to see. `/user/repos` cannot show a scoped token's blind spots, so the numbers
 * have to be compared for the operator: how many the token lists, how many the profile
 * publishes, how many GitHub says the credential can reach.
 *
 * Pure by design — no network, no database — so the wording and the comparisons are
 * asserted directly in `tests/publish.test.mts`.
 */
import type { RepoListResult } from "./github.ts";

export type DiscoveryTone = "ok" | "warn" | "error";

export type DiscoveryFact = { label: string; value: string };

export type DiscoveryReport = {
  tone: DiscoveryTone;
  headline: string;
  detail: string;
  facts: DiscoveryFact[];
  /** Why the list is short, when that is knowable. */
  cause?: "scoped-token" | "no-token" | "empty-account" | "truncated" | "failed";
};

const SCOPE_FIX =
  "Fine-grained tokens only see the repositories ticked under “Repository access”. Open the token on GitHub → Settings → Developer settings → Personal access tokens → Fine-grained, choose “All repositories”, and paste it again here. A classic token with the `repo` scope works too.";

export function diagnoseRepoListing(
  listed: Pick<RepoListResult, "ok" | "repos" | "error" | "source" | "owner" | "organisations" | "totalVisible" | "profilePublicCount">,
  /** Extra context from `tokenSource()` when there is no usable credential at all. */
  tokenDetail?: string,
): DiscoveryReport {
  const visible = listed.repos.length;
  const facts: DiscoveryFact[] = [];
  if (listed.owner) facts.push({ label: "Signed in as", value: listed.owner });
  facts.push({ label: "Repositories this token lists", value: String(visible) });
  if (listed.profilePublicCount !== undefined) {
    facts.push({ label: "Public repositories on that profile", value: String(listed.profilePublicCount) });
  }
  if (listed.totalVisible !== undefined && listed.totalVisible > visible) {
    facts.push({ label: "Repositories GitHub counts for this token", value: String(listed.totalVisible) });
  }
  if (listed.organisations && listed.organisations.length > 0) {
    facts.push({ label: "Organisations", value: listed.organisations.join(", ") });
  }

  if (listed.source === "none" || (!listed.ok && /no github token/i.test(listed.error ?? ""))) {
    return {
      tone: "warn",
      cause: "no-token",
      headline: "Your projects cannot be listed yet — no token is in use.",
      detail:
        tokenDetail ??
        "GitHub cannot tell which repositories are yours without a credential. Paste a token in the GitHub connection panel above.",
      facts,
    };
  }

  if (!listed.ok) {
    return {
      tone: "error",
      cause: "failed",
      headline: "GitHub would not return the repository list.",
      detail: listed.error ?? "The request failed without a message.",
      facts,
    };
  }

  const orgs = listed.organisations ?? [];
  const orgHint =
    orgs.length > 0 && visible === 0
      ? ` The token belongs to a member of ${orgs.join(", ")}, but organisation repositories appear only after the organisation grants the token access (and, with SSO enforced, approves it).`
      : "";

  if (visible === 0) {
    return {
      tone: "warn",
      cause: "scoped-token",
      headline: `The token authenticates${listed.owner ? ` as ${listed.owner}` : ""} but can see no repositories at all.`,
      detail: `${SCOPE_FIX}${orgHint}`,
      facts,
    };
  }

  const profile = listed.profilePublicCount;
  if (profile !== undefined && profile > visible) {
    return {
      tone: "warn",
      cause: "scoped-token",
      headline: `Only ${visible} of the ${profile} repositories on ${listed.owner} ${visible === 1 ? "is" : "are"} visible to this token.`,
      detail: `This is the token's scope, not a hub limit — the list below is everything GitHub disclosed for this credential. ${SCOPE_FIX}${orgHint}`,
      facts,
    };
  }

  if (listed.totalVisible !== undefined && listed.totalVisible > visible) {
    return {
      tone: "warn",
      cause: "truncated",
      headline: `Showing ${visible} of the ${listed.totalVisible} repositories this token can reach.`,
      detail:
        "GitHub paginates the list and the hub stops after 1000 entries. Connect what you need here, or narrow the token's scope instead of paging further.",
      facts,
    };
  }

  return {
    tone: "ok",
    headline: `${visible} repositor${visible === 1 ? "y" : "ies"} visible to this token.`,
    detail:
      "Every repository this token can reach is listed below — pick one to connect it as a tenant. Missing one? Its cause is the token's repository access, never the hub.",
    facts,
  };
}

/** One-line version for a server action result (form results render as a paragraph). */
export function discoveryMessage(report: DiscoveryReport): string {
  const numbers = report.facts
    .filter((fact) => fact.label !== "Signed in as")
    .map((fact) => `${fact.label}: ${fact.value}`)
    .join(" · ");
  return [report.headline, numbers ? `(${numbers})` : "", report.detail].filter(Boolean).join(" ");
}
