import { test, expect } from "@playwright/test";
import { openDiscreteFixture, openExploration } from "./fixtures";
const base = process.env.TEST_PATH || "/";
for (const operation of ["cancel", "stale"] as const)
  test(`real WASM job: ${operation} preserves project and supports retry`, async ({
    page,
  }) => {
    page.on("dialog", (d) => d.accept());
    await page.goto(base);
    await openDiscreteFixture(page);
    await openExploration(page, "States & training");
    await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
    await page
      .getByRole("button", { name: "Train model", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Trained 3 CPTs" }),
    ).toBeVisible();
    await openExploration(page, "Queries");
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const requested = new Promise<void>((r) => (started = r));
    await page.route("**/libagrum.wasm", async (route) => {
      started();
      await barrier;
      await route.continue().catch(() => {});
    });
    await page
      .getByRole("button", { name: "Run selected query", exact: true })
      .click();
    await requested;
    if (operation === "cancel")
      await page.getByRole("button", { name: "Cancel queries" }).click();
    else
      await page
        .getByRole("group", { name: "Query evidence" })
        .getByRole("combobox", { name: "Load", exact: true })
        .selectOption({ label: "High" });
    release();
    await expect(page.locator(".query-statuses")).toContainText("cancelled");
    await page.unroute("**/libagrum.wasm");
    await page
      .getByRole("button", { name: "Run selected query", exact: true })
      .click();
    await expect(
      page.getByText("Current results", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("#results-panel .network-node")).toHaveCount(3);
  });

test("missing WASM preserves work and retry loads a fresh engine", async ({
  page,
}) => {
  await page.goto(base);
  await openDiscreteFixture(page);
  await openExploration(page, "States & training");
  await expect(page.getByText("8 rows retained · 0 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Trained 3 CPTs" }),
  ).toBeVisible();
  await openExploration(page, "Queries");
  await page.route("**/libagrum.wasm", (route) => route.abort());
  await page
    .getByRole("button", { name: "Run selected query", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not initialize WASM",
  );
  await expect(page.locator("#results-panel .network-node")).toHaveCount(3);
  await page.unroute("**/libagrum.wasm");
  await page
    .getByRole("button", { name: "Run selected query", exact: true })
    .click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
});
