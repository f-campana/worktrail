import { useState } from "react";
import type { Card, Detail } from "../types";
import { displayPath, formatDate } from "../format";
import { EvidencePanel } from "./EvidencePanel";
const labels: Record<string, string> = {
  "manual-assignment": "Manual assignment",
  "alias-match": "Alias match",
  "workstream-name-match": "Title match",
  "title-match": "Title match",
  "evidence-text-match": "Evidence text match",
  "file-reference-match": "File reference match",
  "cwd-match": "Cwd match",
  recency: "Recency",
};
function Copy({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1600);
  }
  return (
    <button className="copy" onClick={copy}>
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
const Fact = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className={mono ? "wide" : ""}>
    <label>{label}</label>
    {mono ? <code>{value}</code> : <p>{value}</p>}
  </div>
);
const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="section">
    <h3>{title}</h3>
    {children}
  </section>
);
export function StateCard({
  card,
  detail,
  evidenceOpen,
  evidenceLoading,
  toggleEvidence,
  open,
}: {
  card: Card;
  detail: Detail | null;
  evidenceOpen: boolean;
  evidenceLoading: boolean;
  toggleEvidence: () => void;
  open: (path: string) => void;
}) {
  return (
    <article className="card">
      <div className="cardHead">
        <div>
          <h1>{card.workstream.name}</h1>
          <span className="origin">
            {card.workstream.origin}
            {detail ? ` · ${detail.workstream.status}` : ""}
          </span>
          {card.workstream.id && !detail && (
            <button
              className="detailLink"
              onClick={() =>
                open(`/workstreams/${encodeURIComponent(card.workstream.id!)}`)
              }
            >
              Open workstream →
            </button>
          )}
        </div>
        <div className="score">
          <span className={`dot ${card.confidence}`} />
          <b>{card.confidence}</b>
          <i />
          Score <strong>{card.score.toFixed(2)}</strong>
        </div>
      </div>
      {detail && detail.workstream.aliases.length > 0 && (
        <Section title="Aliases">
          <div className="files">
            {detail.workstream.aliases.map((x) => (
              <code key={x}>{x}</code>
            ))}
          </div>
        </Section>
      )}
      <div className="facts">
        <Fact label="Latest activity" value={formatDate(card.latestActivity)} />
        <Fact
          label="Best thread"
          value={card.bestThread.title ?? "Untitled thread"}
        />
        <Fact
          label="Related threads"
          value={String(card.relatedThreads.length)}
        />
        <div className="wide">
          <label>Resume UUID</label>
          <div className="copyRow">
            <code>{card.bestThread.resumeRef}</code>
            <Copy text={card.bestThread.resumeRef} label="Copy UUID" />
            <Copy
              text={`codex resume ${card.bestThread.resumeRef}`}
              label="Copy command"
            />
          </div>
        </div>
        <Fact label="Working directory" value={displayPath(card.cwd)} mono />
      </div>
      <Section title="Related files">
        <div className="files">
          {card.relatedFiles.length ? (
            card.relatedFiles.map((x) => <code key={x}>{displayPath(x)}</code>)
          ) : (
            <span className="muted">No related files recorded.</span>
          )}
        </div>
      </Section>
      <Section title="Why this matched">
        <div className="signals">
          {card.signals.map((s) => (
            <span key={s.type} title={s.detail}>
              ✓ {labels[s.type] ?? s.type}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Related threads">
        <div className="threads">
          {card.relatedThreads.map((t) => (
            <div className="thread" key={t.externalId}>
              <div>
                <b>{t.title ?? "Untitled thread"}</b>
                {t.archived && <small>Archived</small>}
              </div>
              <time>{formatDate(t.lastActivity)}</time>
              <code>{t.resumeRef}</code>
            </div>
          ))}
        </div>
      </Section>
      <button
        className="disclose"
        disabled={evidenceLoading}
        onClick={toggleEvidence}
        aria-expanded={evidenceOpen}
      >
        {evidenceLoading
          ? "Loading evidence…"
          : evidenceOpen
            ? "⌃ Hide evidence"
            : "⌄ Show evidence"}
      </button>
      <p className="hint">
        Bounded, redacted excerpts fetched only when disclosed.
      </p>
      {evidenceOpen && <EvidencePanel evidence={card.latestEvidence} />}
    </article>
  );
}
