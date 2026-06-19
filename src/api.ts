import { WorktrailDatabase } from "./db/database.js";
import {
  buildStateResponse,
  buildWorkstreamDetail,
  listRecentWorkstreamCards,
} from "./state.js";
import { getIndexStatus } from "./status.js";
import {
  addWorkstreamAlias,
  assignThread,
  createWorkstream,
  ignoreThread,
  removeWorkstreamAlias,
  renameWorkstream,
  unassignThread,
  unignoreThread,
} from "./workstreams.js";

export type ApiResult = { status: number; body: unknown };

export function apiResponse(
  database: WorktrailDatabase,
  dbPath: string,
  url: URL,
  writesEnabled = false,
): ApiResult {
  if (url.pathname === "/api/status")
    return {
      status: 200,
      body: { ...getIndexStatus(database, dbPath), writesEnabled },
    };
  if (url.pathname === "/api/workstreams/recent")
    return {
      status: 200,
      body: { workstreams: listRecentWorkstreamCards(database) },
    };
  const detailMatch = url.pathname.match(/^\/api\/workstreams\/([^/]+)$/);
  if (detailMatch) {
    const detail = buildWorkstreamDetail(
      database,
      decodeURIComponent(detailMatch[1]!),
    );
    if (!detail) return error(404, "not_found", "Workstream not found.");
    if (url.searchParams.get("evidence") !== "1")
      detail.card.latestEvidence = [];
    return { status: 200, body: detail };
  }
  if (url.pathname === "/api/state") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (!query) return error(400, "invalid_request", "Query is required.");
    const response = buildStateResponse(database, query);
    if (url.searchParams.get("evidence") !== "1" && response.best)
      response.best.latestEvidence = [];
    return { status: 200, body: response };
  }
  return error(404, "not_found", "Not found.");
}

export function mutationResponse(
  database: WorktrailDatabase,
  method: string,
  url: URL,
  body: unknown,
  writesEnabled: boolean,
  tokenValid: boolean,
): ApiResult {
  if (!writesEnabled)
    return error(
      403,
      "writes_disabled",
      "Corrections are disabled. Start with --allow-write.",
    );
  if (!tokenValid)
    return error(
      403,
      "invalid_write_token",
      "A valid local write token is required.",
    );
  if (!isObject(body))
    return error(400, "invalid_json", "A JSON object body is required.");
  try {
    if (method === "POST" && url.pathname === "/api/workstreams")
      return {
        status: 201,
        body: {
          workstream: createWorkstream(database, requiredString(body, "name")),
        },
      };
    let match = url.pathname.match(/^\/api\/workstreams\/([^/]+)$/);
    if (method === "PATCH" && match)
      return {
        status: 200,
        body: {
          workstream: renameWorkstream(
            database,
            decode(match[1]!),
            requiredString(body, "name"),
          ),
        },
      };
    match = url.pathname.match(/^\/api\/workstreams\/([^/]+)\/aliases$/);
    if (method === "POST" && match)
      return {
        status: 201,
        body: {
          alias: addWorkstreamAlias(
            database,
            decode(match[1]!),
            requiredString(body, "alias"),
          ),
        },
      };
    match = url.pathname.match(
      /^\/api\/workstreams\/([^/]+)\/aliases\/([^/]+)$/,
    );
    if (method === "DELETE" && match) {
      const removed = removeWorkstreamAlias(
        database,
        decode(match[1]!),
        decode(match[2]!),
      );
      return removed
        ? { status: 200, body: { removed: true } }
        : error(404, "not_found", "Alias not found.");
    }
    match = url.pathname.match(/^\/api\/threads\/([^/]+)\/assignment$/);
    if (method === "POST" && match)
      return {
        status: 200,
        body: {
          assignment: assignThread(
            database,
            decode(match[1]!),
            requiredString(body, "workstreamId"),
          ),
        },
      };
    if (method === "DELETE" && match)
      return {
        status: 200,
        body: { removed: unassignThread(database, decode(match[1]!)) },
      };
    match = url.pathname.match(/^\/api\/threads\/([^/]+)\/ignore$/);
    if (method === "POST" && match) {
      ignoreThread(database, decode(match[1]!), optionalString(body, "reason"));
      return {
        status: 200,
        body: { ignored: true, threadId: decode(match[1]!) },
      };
    }
    if (method === "DELETE" && match)
      return {
        status: 200,
        body: { ignored: !unignoreThread(database, decode(match[1]!)) },
      };
    return error(404, "not_found", "Correction endpoint not found.");
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Correction failed.";
    const notFound = message.startsWith("Unknown ");
    const duplicate = /already|duplicates|conflicts/.test(message);
    return error(
      notFound ? 404 : duplicate ? 409 : 400,
      notFound ? "not_found" : duplicate ? "conflict" : "invalid_request",
      message,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredString(body: Record<string, unknown>, key: string): string {
  if (typeof body[key] !== "string" || !body[key].trim())
    throw new Error(`${key} must be a non-empty string.`);
  return body[key];
}
function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "string")
    throw new Error(`${key} must be a string.`);
  return body[key];
}
function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Invalid URL identifier.");
  }
}
function error(status: number, code: string, message: string): ApiResult {
  return { status, body: { error: { code, message } } };
}
