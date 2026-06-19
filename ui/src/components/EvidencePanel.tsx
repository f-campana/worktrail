import type { Evidence } from "../types";
import { formatDate } from "../format";
export function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  return <div className="evidence">{evidence.length ? evidence.map((item, index) => <div key={index}><div><b>{item.kind}</b><span>{formatDate(item.occurredAt)} · source line {item.recordLine}</span></div><p>{item.excerpt}</p></div>) : <p className="notice">No evidence excerpts are available.</p>}</div>;
}
