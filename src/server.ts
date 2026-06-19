import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { apiResponse } from "./api.js";
import { WorktrailDatabase } from "./db/database.js";

const args = process.argv.slice(2); const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dbPath = resolve(flag("db") ?? join(homedir(), ".worktrail/worktrail.db"));
const port = Number(flag("port") ?? 4173); const root = resolve("ui/dist");
const database = new WorktrailDatabase(dbPath);
const mime: Record<string,string> = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml" };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname.startsWith("/api/")) { const out = apiResponse(database, dbPath, url); res.writeHead(out.status, { "content-type":"application/json", "cache-control":"no-store" }); res.end(JSON.stringify(out.body)); return; }
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1); let file = join(root, requested); if (!existsSync(file)) file = join(root, "index.html");
  if (!existsSync(file)) { res.writeHead(503, { "content-type":"text/plain" }); res.end("UI is not built. Run pnpm ui:build first."); return; }
  res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file));
});
server.listen(port, "127.0.0.1", () => console.log(`Worktrail UI: http://127.0.0.1:${port}\nDatabase: ${dbPath}`));
process.on("SIGINT", () => { database.close(); server.close(); });
