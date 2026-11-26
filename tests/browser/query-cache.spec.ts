import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { train } from "../../src/processing";
import { openDiscreteFixture, openExploration } from "./fixtures";

test("parallel results isolate failures, survive without CSV, and track query edits", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(process.env.TEST_PATH || "/");
  await openDiscreteFixture(page, (p, dataset) => {
    p.cpts = train(dataset, p, "mle", 0).cpts;
    const [load, material, failure] = p.variables;
    const targetIds = [failure.id];
    p.queryGroups = [
      { id: "low", name: "Low load", targetIds, evidence: { [load.id]: 1 } },
      { id: "high", name: "High load", targetIds, evidence: { [load.id]: 0 } },
      {
        id: "bad",
        name: "Impossible",
        targetIds,
        evidence: {
          [load.id]: 1,
          [material.id]: material.states.indexOf("Steel"),
          [failure.id]: failure.states.indexOf("Yes"),
        },
      },
    ];
  });
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("Query portfolio");
  await expect(page).toHaveTitle("Query portfolio · PDOPT-BN");
  await openExploration(page, "Queries");
  await page.getByRole("button", { name: "Run all queries" }).click();
  const results = page.locator("#results-panel");
  const query = results.getByRole("combobox", { name: "Query", exact: true });
  await expect(results.getByText("Current results")).toBeVisible();
  await query.selectOption("high");
  const parallel = await results.locator(".marginal-table").innerText();
  await expect(results.locator(".query-notation")).toContainText("High");
  await results.getByRole("button", { name: "Edit query" }).click();
  await expect(page.locator(".query-statuses")).toContainText(
    "Impossible · failed",
  );
  await page.getByRole("button", { name: "Run selected query" }).click();
  await expect(results.locator(".marginal-table")).toHaveText(
    parallel.replace(/\s+/g, " ").trim(),
    { useInnerText: true },
  );
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = JSON.parse(
    await readFile((await (await saved).path())!, "utf8"),
  );
  expect(
    project.savedResults.map((entry: { id: string }) => entry.id).sort(),
  ).toEqual(["high", "low"]);
  delete project.dataset.embeddedCsv;
  await page.getByTestId("project-file").setInputFiles({
    name: "detached.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText(/Locate its CSV/)).toBeVisible();
  await openExploration(page, "Results");
  await query.selectOption("high");
  await expect(results.getByText("Current results")).toBeVisible();
  await results.getByRole("button", { name: "Edit query" }).click();
  await page
    .getByRole("group", { name: "Query evidence" })
    .getByRole("combobox", { name: "Load", exact: true })
    .selectOption({ label: "Low" });
  await openExploration(page, "Results");
  await expect(results.getByText(/Outdated results/)).toBeVisible();
  await query.selectOption("low");
  await expect(results.getByText("Current results")).toBeVisible();

  await page.getByRole("button", { name: "Sample distribution" }).click();
  await page.getByRole("spinbutton", { name: "Sample count" }).fill("20");
  await page.getByRole("button", { name: "Generate samples" }).click();
  await page.getByText("Predict additional variables", { exact: true }).click();
  await page
    .getByRole("group", { name: "Prediction outputs" })
    .getByRole("checkbox", { name: "Load", exact: true })
    .check();
  await page.getByRole("button", { name: "Fit or reuse surrogates" }).click();
  await expect(
    page.getByText(/Attach the CSV to fit this output/),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Sample analytics" }),
  ).toBeVisible();
});
