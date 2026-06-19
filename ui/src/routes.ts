export type Route = { detail?: string; query: string };
export function currentRoute(): Route {
  return { detail: location.pathname.match(/^\/workstreams\/([^/]+)$/)?.[1], query: new URLSearchParams(location.search).get("q") ?? "" };
}
export function navigate(path: string) { history.pushState({}, "", path); }
