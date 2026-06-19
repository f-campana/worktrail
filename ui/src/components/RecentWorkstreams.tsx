import type { Recent } from "../types";
import { formatDate } from "../format";
export function RecentWorkstreams({
  items,
  open,
}: {
  items: Recent[];
  open: (path: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="recent">
      <h2>Recent workstreams</h2>
      {items.map((item) => (
        <button
          key={item.workstream.id}
          onClick={() =>
            open(`/workstreams/${encodeURIComponent(item.workstream.id)}`)
          }
        >
          <b>{item.workstream.name}</b>
          <span>
            {formatDate(item.latestActivity)} · {item.confidence} confidence ·{" "}
            {item.threadCount} thread{item.threadCount === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </section>
  );
}
