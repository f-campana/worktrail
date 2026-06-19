import type { Status } from "../types";
import { displayPath, formatDate } from "../format";
export function StatusPanel({
  status,
  error,
  refreshed,
  refresh,
}: {
  status: Status | null;
  error: string;
  refreshed: string | null;
  refresh: () => void;
}) {
  return (
    <aside id="status">
      <div className="statusHead">
        <h2>Index status</h2>
        <button onClick={refresh}>Refresh</button>
      </div>
      {status ? (
        <>
          <label>Database path</label>
          <code>{displayPath(status.databasePath)}</code>
          <label>Latest indexing run</label>
          <p>
            {formatDate(status.latestRun?.completedAt)}{" "}
            {status.latestRun && (
              <span className="success">{status.latestRun.status}</span>
            )}
          </p>
          {Object.values(status.counts).every((x) => x === 0) && (
            <p className="notice">
              No indexed sources yet. Run the index command to begin.
            </p>
          )}
          <dl>
            {Object.entries(status.counts).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <small>
            Last refreshed {formatDate(refreshed)} · refreshes every 30s
          </small>
        </>
      ) : (
        <p>Loading metadata…</p>
      )}
      {error && <p className="statusWarning">{error}</p>}
    </aside>
  );
}
