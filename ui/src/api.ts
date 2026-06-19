import type { Detail, Recent, State, Status } from "./types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body as T;
}

export const api = {
  state: (query: string, evidence = false, signal?: AbortSignal) => getJson<State>(`/api/state?q=${encodeURIComponent(query)}${evidence ? "&evidence=1" : ""}`, signal),
  detail: (id: string, evidence = false, signal?: AbortSignal) => getJson<Detail>(`/api/workstreams/${encodeURIComponent(id)}${evidence ? "?evidence=1" : ""}`, signal),
  recent: (signal?: AbortSignal) => getJson<{ workstreams: Recent[] }>("/api/workstreams/recent", signal),
  status: (signal?: AbortSignal) => getJson<Status>("/api/status", signal),
};
