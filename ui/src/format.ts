export const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
export function displayPath(path: string | null, home?: string | null) {
  if (!path) return "—";
  if (home && (path === home || path.startsWith(`${home}/`)))
    return `~${path.slice(home.length)}`;
  const match = path.match(/^\/Users\/[^/]+(?=\/|$)|^\/home\/[^/]+(?=\/|$)/);
  return match ? `~${path.slice(match[0].length)}` : path;
}
