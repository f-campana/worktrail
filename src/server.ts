import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { apiResponse, mutationResponse } from "./api.js";
import { WorktrailDatabase } from "./db/database.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const writesEnabled = args.includes("--allow-write");
const writeToken = writesEnabled ? randomBytes(32).toString("base64url") : "";
const dbPath = resolve(
  flag("db") ?? join(homedir(), ".worktrail/worktrail.db"),
);
const port = Number(flag("port") ?? 4173);
const root = resolve("ui/dist");
const database = new WorktrailDatabase(dbPath);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? "";
  if (!validHost(host))
    return sendJson(res, 403, {
      error: { code: "invalid_host", message: "Local Host header required." },
    });
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (url.pathname === "/api/bootstrap" && req.method === "GET")
    return sendJson(res, 200, {
      writesEnabled,
      ...(writesEnabled ? { writeToken } : {}),
    });
  if (url.pathname.startsWith("/api/") && isMutation(req.method)) {
    if (!validOrigin(req.headers.origin, host))
      return sendJson(res, 403, {
        error: {
          code: "invalid_origin",
          message: "Same-origin request required.",
        },
      });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (cause) {
      return sendJson(res, 400, {
        error: {
          code: "invalid_json",
          message: cause instanceof Error ? cause.message : "Invalid JSON.",
        },
      });
    }
    const out = mutationResponse(
      database,
      req.method!,
      url,
      body,
      writesEnabled,
      tokenMatches(req.headers["x-worktrail-write-token"]),
    );
    return sendJson(res, out.status, out.body);
  }
  if (url.pathname.startsWith("/api/")) {
    const out = apiResponse(database, dbPath, url, writesEnabled);
    return sendJson(res, out.status, out.body);
  }
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  let file = join(root, requested);
  if (!existsSync(file)) file = join(root, "index.html");
  if (!existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("UI is not built. Run pnpm ui:build first.");
  }
  res.writeHead(200, {
    "content-type": mime[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Worktrail UI: http://127.0.0.1:${port}\nDatabase: ${dbPath}\nCorrections: ${writesEnabled ? "enabled" : "disabled"}`,
  ),
);
process.on("SIGINT", () => {
  database.close();
  server.close();
});

function isMutation(method?: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}
function validHost(host: string): boolean {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}
function validOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) return false;
  try {
    const value = new URL(origin);
    return (
      value.protocol === "http:" &&
      value.host === host &&
      (value.hostname === "127.0.0.1" || value.hostname === "localhost")
    );
  } catch {
    return false;
  }
}
function tokenMatches(value: string | string[] | undefined): boolean {
  if (!writesEnabled || typeof value !== "string") return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(writeToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("JSON body is too large.");
    chunks.push(buffer);
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
