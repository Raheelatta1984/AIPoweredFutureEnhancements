import Link from "next/link";

import { StableId } from "./Shell.tsx";

const STATUS_TONE: Record<string, string> = {
  Submitted: "accent",
  Reviewing: "violet",
  Accepted: "amber",
  Building: "mint",
  Built: "mint",
  Archived: "off",
  Rejected: "rose",
};

export function StatusTag({ status }: { status: string }) {
  const tone = STATUS_TONE[status];
  const className = tone && tone !== "off" ? `tag ${tone}` : "tag";
  return <span className={className}>{status}</span>;
}

export function AiTag({ field, label }: { field: string; label?: string }) {
  return (
    <span className="tag accent ai" title={`AI-drafted: ${field}. Edit it and it becomes author-owned.`}>
      ✦ {label ?? field}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Kpi({ n, label, tone }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="n" style={tone ? { color: tone } : undefined}>
        {n}
      </span>
    </div>
  );
}

export function Card({
  title,
  sid,
  actions,
  children,
  flat,
}: {
  title?: string;
  sid?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flat?: boolean;
}) {
  return (
    <section className={flat ? "card flat" : "card"}>
      {title || actions ? (
        <div className="card-head">
          {title ? (
            <h2>
              {title} {sid ? <StableId id={sid} /> : null}
            </h2>
          ) : null}
          <div className="spacer" />
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "error" | "warn" | "info"; children: React.ReactNode }) {
  const glyph = tone === "ok" ? "✓" : tone === "error" ? "!" : tone === "warn" ? "!" : "i";
  return (
    <div className={`notice ${tone === "info" ? "" : tone}`}>
      <span className="icon">{glyph}</span>
      <div>{children}</div>
    </div>
  );
}

export function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={active ? "on" : undefined} prefetch={false}>
      {children}
    </Link>
  );
}

export function StageChips({
  counts,
  current,
  basePath,
}: {
  counts: Record<string, number>;
  current: string;
  basePath: string;
}) {
  const stages = ["all", "Submitted", "Reviewing", "Accepted", "Building", "Built", "Archived", "Rejected"];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="stage-chips">
      {stages.map((stage) => {
        const n = stage === "all" ? total : counts[stage] ?? 0;
        const href = stage === "all" ? basePath : `${basePath}?stage=${stage}`;
        return (
          <Chip key={stage} href={href} active={current === stage}>
            {stage === "all" ? "All stages" : stage}
            <span className="c">{n}</span>
          </Chip>
        );
      })}
    </div>
  );
}
