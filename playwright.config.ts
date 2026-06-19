import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/browser", use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" }, webServer: { command: "pnpm exec vite --config ui/vite.config.ts --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true }, reporter: "line" });
