import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { currentRoute, navigate } from "./routes";
import type { Detail, Recent, State, Status } from "./types";
import { RecentWorkstreams } from "./components/RecentWorkstreams";
import { StateCard } from "./components/StateCard";
import { StatusPanel } from "./components/StatusPanel";
const examples = [
  "resume widget repair",
  "where did we implement sitemap.ts?",
  "latest work on ShipReady safe apply",
];
export default function App() {
  const initial = currentRoute();
  const [query, setQuery] = useState(initial.query);
  const [result, setResult] = useState<State | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refreshStatus = useCallback(() => {
    api
      .status()
      .then((x) => {
        setStatus(x);
        setRefreshed(new Date().toISOString());
        setStatusError("");
      })
      .catch(() => setStatusError("Index status could not be refreshed."));
  }, []);
  const loadRoute = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const route = currentRoute();
    setEvidenceOpen(false);
    setError("");
    setQuery(route.query);
    setLoading(Boolean(route.detail || route.query));
    try {
      if (route.detail) {
        setResult(null);
        setDetail(await api.detail(route.detail, false, controller.signal));
      } else {
        setDetail(null);
        setResult(
          route.query
            ? await api.state(route.query, false, controller.signal)
            : null,
        );
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      setDetail(null);
      setResult(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "This view could not be loaded.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadRoute();
    refreshStatus();
    const controller = new AbortController();
    api
      .recent(controller.signal)
      .then((x) => setRecent(x.workstreams))
      .catch(() => {});
    const pop = () => loadRoute();
    addEventListener("popstate", pop);
    const timer = setInterval(refreshStatus, 30000);
    return () => {
      request.current?.abort();
      controller.abort();
      removeEventListener("popstate", pop);
      clearInterval(timer);
    };
  }, [loadRoute, refreshStatus]);
  function open(path: string) {
    navigate(path);
    loadRoute();
  }
  function search(e?: FormEvent) {
    e?.preventDefault();
    const value = query.trim();
    if (value) open(`/search?q=${encodeURIComponent(value)}`);
  }
  async function toggleEvidence() {
    if (evidenceOpen) {
      setEvidenceOpen(false);
      return;
    }
    const card = detail?.card ?? result?.best;
    if (!card) return;
    setEvidenceLoading(true);
    try {
      if (detail) setDetail(await api.detail(card.workstream.id!, true));
      else setResult(await api.state(result!.query, true));
      setEvidenceOpen(true);
    } catch {
      setError("Evidence is unavailable.");
    } finally {
      setEvidenceLoading(false);
    }
  }
  const card = detail?.card ?? result?.best;
  return (
    <>
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            open("/");
          }}
        >
          W<span>Worktrail</span>
        </a>
        <span className="local">
          local · {status?.writesEnabled ? "corrections enabled" : "read-only"}
        </span>
        <nav>
          <a href="/">Search</a>
          <a href="#status">Index status</a>
        </nav>
      </header>
      <main>
        <section id="search" className="content">
          <form onSubmit={search}>
            <span className="glass">⌕</span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask where work happened…"
              aria-label="Ask where work happened"
            />
            <button disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </button>
          </form>
          {loading && <div className="notice">Loading work…</div>}
          {!loading && !card && !error && !result && !detail && (
            <>
              <div className="intro">
                <h1>Find the thread. Recover the state.</h1>
                <p>Search your local Codex work by what you remember.</p>
                <div className="examples">
                  {examples.map((x) => (
                    <button key={x} onClick={() => setQuery(x)}>
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <RecentWorkstreams items={recent} open={open} />
            </>
          )}
          {error && (
            <div className="empty error">
              <h2>Worktrail couldn’t load this view</h2>
              <p>
                {error} Check that the local server and index are available.
              </p>
            </div>
          )}
          {result && !card && !loading && (
            <div className="empty">
              <h2>No matching work found</h2>
              <p>
                Try a thread title, file path, working directory, or phrase from
                the work.
              </p>
            </div>
          )}
          {card && (
            <StateCard
              card={card}
              detail={detail}
              evidenceOpen={evidenceOpen}
              evidenceLoading={evidenceLoading}
              toggleEvidence={toggleEvidence}
              open={open}
            />
          )}
        </section>
        <StatusPanel
          status={status}
          error={statusError}
          refreshed={refreshed}
          refresh={refreshStatus}
        />
      </main>
      <footer>
        All data stays on this machine. Evidence stays hidden until requested.
      </footer>
    </>
  );
}
