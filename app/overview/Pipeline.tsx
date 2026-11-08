import Link from "next/link";

const STAGES: Array<{ key: string; tone: string }> = [
  { key: "Submitted", tone: "#5b8cff" },
  { key: "Reviewing", tone: "#a78bfa" },
  { key: "Accepted", tone: "#f3b95f" },
  { key: "Building", tone: "#4fd1a5" },
  { key: "Built", tone: "#38b48a" },
];

/** Simple, dependency-free stage bar. */
export function Pipeline({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <div className="empty">The pipeline is empty.</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "#0b1220" }}>
        {STAGES.map((stage) => {
          const n = counts[stage.key] ?? 0;
          if (n === 0) return null;
          return (
            <div
              key={stage.key}
              title={`${stage.key}: ${n}`}
              style={{ width: `${(n / total) * 100}%`, background: stage.tone, opacity: 0.9 }}
            />
          );
        })}
      </div>
      <div className="row" style={{ gap: 14 }}>
        {STAGES.map((stage) => (
          <Link
            key={stage.key}
            href={`/vault?stage=${stage.key}`}
            className="row tight"
            prefetch={false}
            style={{ fontSize: 12.5, color: "var(--muted)", textDecoration: "none" }}
          >
            <span className="badge-dot" style={{ background: stage.tone }} />
            {stage.key} <span className="mono tiny dim">{counts[stage.key] ?? 0}</span>
          </Link>
        ))}
        <span className="spacer" />
        <span className="tiny dim">
          Archived {counts.Archived ?? 0} · Rejected {counts.Rejected ?? 0}
        </span>
      </div>
    </div>
  );
}
