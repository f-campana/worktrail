import { expect, test, type Page } from "@playwright/test";
const card = (name = "Widget repair", evidence = false) => ({
  workstream: { id: "ws_1", name, origin: "manual" },
  score: 0.9,
  confidence: "high",
  latestActivity: "2026-01-02T12:00:00Z",
  cwd: "/Users/tester/projects/widget",
  bestThread: {
    externalId: "t1",
    title: `${name} thread`,
    archived: false,
    lastActivity: "2026-01-02T12:00:00Z",
    resumeRef: "00000000-0000-4000-8000-000000000001",
  },
  relatedThreads: [],
  relatedFiles: ["/Users/tester/projects/widget/src/a.ts"],
  signals: [{ type: "title-match", detail: "title" }],
  latestEvidence: evidence
    ? [
        {
          kind: "message",
          excerpt: "Evidence excerpt",
          occurredAt: "2026-01-02T12:00:00Z",
          recordLine: 4,
        },
      ]
    : [],
});
async function mock(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status")
      return route.fulfill({
        json: {
          databasePath: "/Users/tester/.worktrail/worktrail.db",
          latestRun: {
            completedAt: "2026-01-02T12:00:00Z",
            status: "complete",
          },
          counts: { threads: 2, workstreams: 1 },
        },
      });
    if (url.pathname === "/api/workstreams/recent")
      return route.fulfill({ json: { workstreams: [] } });
    if (url.pathname.startsWith("/api/workstreams/")) {
      const id = url.pathname.split("/").pop();
      return route.fulfill({
        json: {
          workstream: { status: "active", aliases: [] },
          card: card(
            id === "ws_2" ? "Second stream" : "Widget repair",
            url.searchParams.get("evidence") === "1",
          ),
        },
      });
    }
    const q = url.searchParams.get("q")!;
    return route.fulfill({
      json: {
        query: q,
        best:
          q === "none"
            ? null
            : card(
                q === "second" ? "Second stream" : "Widget repair",
                url.searchParams.get("evidence") === "1",
              ),
      },
    });
  });
}
test.beforeEach(async ({ page }) => mock(page));
test("deep links, history, empty state, status, and paths", async ({
  page,
}) => {
  await page.goto("/search?q=widget");
  await expect(
    page.getByRole("heading", { name: "Widget repair" }),
  ).toBeVisible();
  await expect(page.getByText("~/.worktrail/worktrail.db")).toBeVisible();
  await expect(
    page.getByText("~/projects/widget", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Last refreshed/)).toBeVisible();
  await page.getByLabel("Ask where work happened").fill("second");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("heading", { name: "Second stream" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Widget repair" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Second stream" }),
  ).toBeVisible();
  await page.getByLabel("Ask where work happened").fill("none");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching work found" }),
  ).toBeVisible();
});
test("evidence remains opt-in", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("evidence=1")) requests.push(r.url());
  });
  await page.goto("/search?q=widget");
  await expect(page.getByText("Evidence excerpt")).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: /Show evidence/ }).click();
  await expect(page.getByText("Evidence excerpt")).toBeVisible();
  expect(requests).toHaveLength(1);
});
test("detail route and clipboard are safe", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/workstreams/ws_1");
  await expect(
    page.getByRole("heading", { name: "Widget repair" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy UUID" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    }),
  );
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(page.getByRole("button", { name: "Copy failed" })).toBeVisible();
});
test("API error and narrow layout", async ({ page }) => {
  await page.route("**/api/state**", (r) =>
    r.fulfill({ status: 500, json: { error: "Database unavailable" } }),
  );
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/search?q=broken");
  await expect(
    page.getByRole("heading", { name: "Worktrail couldn’t load this view" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
test("stale route responses cannot replace the current route", async ({
  page,
}) => {
  await page.route("**/api/state?q=slow", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      json: { query: "slow", best: card("Stale stream") },
    });
  });
  await page.goto("/search?q=widget");
  await page.getByLabel("Ask where work happened").fill("slow");
  await page.getByRole("button", { name: "Search" }).click();
  await page.evaluate(() => history.pushState({}, "", "/workstreams/ws_2"));
  await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
  await expect(
    page.getByRole("heading", { name: "Second stream" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole("heading", { name: "Stale stream" })).toHaveCount(
    0,
  );
});
