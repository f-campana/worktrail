import { WorktrailDatabase } from "./db/database.js";
import { buildStateResponse, buildWorkstreamDetail, listRecentWorkstreamCards } from "./state.js";
import { getIndexStatus } from "./status.js";

export function apiResponse(database: WorktrailDatabase, dbPath: string, url: URL): { status: number; body: unknown } {
  if (url.pathname === "/api/status") return { status: 200, body: getIndexStatus(database, dbPath) };
  if (url.pathname === "/api/workstreams/recent") return { status: 200, body: { workstreams: listRecentWorkstreamCards(database) } };
  const detailMatch = url.pathname.match(/^\/api\/workstreams\/([^/]+)$/);
  if (detailMatch) {
    const detail = buildWorkstreamDetail(database, decodeURIComponent(detailMatch[1]!));
    if (!detail) return { status: 404, body: { error: "Workstream not found." } };
    if (url.searchParams.get("evidence") !== "1") detail.card.latestEvidence = [];
    return { status: 200, body: detail };
  }
  if (url.pathname === "/api/state") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query) return { status: 400, body: { error: "Query is required." } };
    const response = buildStateResponse(database, query);
    if (url.searchParams.get("evidence") !== "1" && response.best) {
      response.best.latestEvidence = [];
    }
    return { status: 200, body: response };
  }
  return { status: 404, body: { error: "Not found." } };
}
