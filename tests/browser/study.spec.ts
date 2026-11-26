import { readFile } from "node:fs/promises";
import { openExploration } from "./fixtures";
import Papa from "papaparse";
import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 8000 });

async function loadDesignQuery(page: Page) {
  await page.goto(process.env.TEST_PATH || "/");
  await page
    .getByRole("button", { name: "Load cantilever beam example" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Cantilever example ready",
  );
  await openExploration(page, "States & training");
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.getByRole("status")).toContainText("Trained 8 CPTs");
  await openExploration(page, "Queries");
  await page.getByRole("tab", { name: "Design space" }).click();
  await page.getByRole("button", { name: "Run selected query" }).click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
}

test("creates, previews, applies and reopens sampled and calculated data", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  const tabs = page.getByRole("tablist", { name: "Workspace" });
  await expect(tabs.getByRole("tab").first()).toHaveText("Data");
  await expect(
    tabs.getByRole("tab", { name: "Data", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const data = page.getByRole("tabpanel", { name: "Data", exact: true });
  await expect(
    data.getByRole("button", { name: "Calculate column" }),
  ).toBeDisabled();
  await data.getByRole("button", { name: "Sample column" }).click();
  await expect(
    data.getByRole("textbox", { name: "Column name" }),
  ).toBeFocused();
  await expect(
    data.getByRole("spinbutton", { name: "Row count" }),
  ).toBeInViewport();
  await expect(
    data.getByRole("button", { name: "Preview column" }),
  ).toBeInViewport();
  await data.getByRole("textbox", { name: "Column name" }).fill("Width");
  await data.getByRole("spinbutton", { name: "Lower bound" }).fill("10");
  await data.getByRole("spinbutton", { name: "Upper bound" }).fill("50");
  await data.getByRole("button", { name: "Preview column" }).click();
  await expect(
    data.getByText("512 values ready · 0 missing or invalid"),
  ).toBeVisible();
  const value = await data
    .locator(".raw-data-table tbody tr[aria-rowindex='2'] td")
    .textContent();
  await data.getByRole("button", { name: "Apply column" }).click();
  await expect(
    data.locator(".raw-data-table tbody tr[aria-rowindex='2'] td"),
  ).toHaveText(value!);
  await data.getByRole("button", { name: "Calculate column" }).click();
  await data.getByRole("textbox", { name: "Column name" }).fill("Is wide");
  await data.getByRole("textbox", { name: "Formula" }).fill("=[Width] >= 30");
  await data.getByRole("button", { name: "Preview column" }).click();
  await expect(
    data.getByText("512 values ready · 0 missing or invalid"),
  ).toBeVisible();
  await data.getByRole("button", { name: "Apply column" }).click();
  const csvDownload = page.waitForEvent("download");
  await data.getByRole("button", { name: "Download CSV" }).click();
  const csv = await csvDownload;
  const rows = Papa.parse<string[]>(
    await readFile((await csv.path())!, "utf8"),
    { skipEmptyLines: true },
  ).data;
  expect(rows[0]).toEqual(["Width", "Is wide"]);
  expect(rows).toHaveLength(513);
  expect(
    rows
      .slice(1)
      .every(
        ([width, isWide]) => isWide === String(Number(Number(width) >= 30)),
      ),
  ).toBe(true);
  await data.getByRole("button", { name: "Add to network" }).click();
  await expect(page.locator(".statusbar")).toContainText("1 variables");
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await data.getByText("Data settings", { exact: true }).click();
  await data.getByRole("checkbox", { name: "Include raw CSV" }).uncheck();
  const detachedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles((await (await detachedDownload).path())!);
  await expect(
    data.getByRole("button", { name: "Locate project CSV" }),
  ).toBeVisible();
  await page.getByTestId("attach-file").setInputFiles({
    name: "wrong.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Width,Is wide\n1,0\n2,0"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Your project was preserved",
  );
  await expect(page.locator(".statusbar")).toContainText("1 variables");
  await page.getByTestId("attach-file").setInputFiles((await csv.path())!);
  await expect(page.getByRole("status")).toContainText(
    "Matching dataset reattached.",
  );
  await data.getByText("Data settings", { exact: true }).click();
  await expect(
    data.getByRole("checkbox", { name: "Include raw CSV" }),
  ).toBeChecked();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles((await (await download).path())!);
  await expect(page.getByRole("status")).toContainText(
    "Project and dataset opened",
  );
  await expect(
    page
      .getByRole("tabpanel", { name: "Network", exact: true })
      .getByText("512 rows · 2 columns", { exact: true }),
  ).toBeVisible();
});

test("keeps trained query results after appending an unused beam formula", async ({
  page,
}) => {
  await loadDesignQuery(page);
  const result = page.locator("#results-panel .joint-heatmap");
  const before = await result
    .locator("[data-cell]")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("title")));
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  const data = page.getByRole("tabpanel", { name: "Data", exact: true });
  await data.getByRole("button", { name: "Calculate column" }).click();
  await data.getByRole("textbox", { name: "Column name" }).fill("Area");
  await data
    .getByRole("textbox", { name: "Formula" })
    .fill("=[Width (mm)] * [Depth (mm)]");
  await data.getByRole("button", { name: "Preview column" }).click();
  await expect(
    data.getByText("512 values ready · 0 missing or invalid"),
  ).toBeVisible();
  await data.getByRole("button", { name: "Apply column" }).click();
  await openExploration(page, "Results");
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  expect(
    await result
      .locator("[data-cell]")
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("title"))),
  ).toEqual(before);
  await expect(page.locator(".statusbar")).toContainText("8 trained CPTs");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles((await (await download).path())!);
  await expect(page.getByRole("status")).toContainText(
    "Project and dataset opened",
  );
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(
    data.getByRole("columnheader", { name: "Area", exact: true }),
  ).toBeVisible();
  await openExploration(page, "Queries");
  await page.getByRole("tab", { name: "Design space", exact: true }).click();
  await page
    .getByRole("button", { name: "Run selected query", exact: true })
    .click();
  await expect(result).toBeVisible();
  expect(
    await result
      .locator("[data-cell]")
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("title"))),
  ).toEqual(before);
});

test("launches a query study, explores the predicted front and links plot selection to export", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loadDesignQuery(page);
  await page
    .getByRole("button", { name: "Start study from this query" })
    .click();
  const study = page.getByRole("tabpanel", {
    name: "Optimisation Study",
    exact: true,
  });
  await expect(study.locator(".query-notation")).toContainText(
    "Beam mass (kg) < 1",
  );
  await expect(
    study.getByRole("spinbutton", { name: "Posterior coverage (%)" }),
  ).toHaveValue("90");
  await study.getByText("Review joint design regions").click();
  await expect(
    study.getByRole("columnheader", { name: "Observed rows" }),
  ).toBeVisible();
  await expect(
    study.getByRole("button", { name: "Evaluate requirement probability" }),
  ).toBeEnabled();
  await study
    .getByRole("button", { name: "Evaluate requirement probability" })
    .click();
  await expect(
    study.getByRole("columnheader", {
      name: "P(requirements met | region, conditions)",
    }),
  ).toBeVisible();
  await study.getByText("Review joint design regions").click();
  await study
    .getByRole("combobox", { name: "Inspect", exact: true })
    .selectOption({ label: "Tip load (N)" });
  await expect(study.getByText(/Query permits/)).toContainText("87.50");
  await study
    .getByRole("spinbutton", { name: "Exact operating value" })
    .fill("110");
  await study
    .getByRole("spinbutton", { name: "Exact operating value" })
    .press("Tab");
  await study
    .getByRole("combobox", { name: "Inspect", exact: true })
    .selectOption({ label: "Beam mass (kg)" });
  await expect(
    study.getByRole("combobox", { name: "Objective", exact: true }),
  ).toHaveValue("min");
  await expect(
    study.getByRole("combobox", { name: "Constraint", exact: true }),
  ).toHaveValue("numeric");
  await expect(
    study.getByRole("spinbutton", { name: "Limit", exact: true }),
  ).toHaveValue("1");
  await study
    .getByRole("button", { name: "Review and fit surrogates" })
    .click();
  const search = study.getByRole("button", { name: "Search retained regions" });
  await expect(search).toBeEnabled({ timeout: 20000 });
  await expect(
    study.getByRole("row").filter({ hasText: /Beam mass \(kg\).*MAE/ }),
  ).toBeVisible();
  await search.click();
  await expect(
    study.getByRole("button", { name: "Pareto", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(study.getByText("Surrogate predictions")).toBeVisible();
  const selected = study.locator(".study-selection [role='status']");
  await expect(selected).toHaveText(/^[1-9][0-9,]* selected/);
  const plot = study.locator("canvas[aria-label='Pareto chart']");
  const bounds = (await plot.boundingBox())!;
  await page.mouse.move(bounds.x + 67, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 10,
    bounds.y + bounds.height - 40,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(
    study.getByRole("button", { name: "Clear selection" }),
  ).toBeEnabled();
  const original = await selected.textContent();
  await study
    .getByRole("button", { name: "Parallel coordinates", exact: true })
    .click();
  await expect(selected).toHaveText(original!);
  await study.getByRole("button", { name: "Floating scatter plot" }).click();
  const scatter = study.getByRole("region", { name: "Study scatter" });
  await scatter.getByLabel("X axis").selectOption({ label: "Width (mm)" });
  const parallel = study.locator(
    "canvas[aria-label='Parallel coordinates chart']",
  );
  await expect(parallel).toBeVisible();
  const frame = (await parallel.boundingBox())!;
  // Width is the left axis. Drag an interval, then slide the interval while held.
  const x = frame.x + 66,
    y = Math.min(frame.y + 70, frame.y + frame.height - 100);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 7 });
  await expect(
    study.getByRole("button", { name: "Clear brushes" }),
  ).toBeEnabled();
  await page.mouse.up();
  const brush = study.getByRole("spinbutton", { name: "Brush minimum" });
  const before = await brush.inputValue();
  await page.mouse.move(x, y + 50);
  await page.mouse.down();
  await page.mouse.move(x, y + 90, { steps: 5 });
  await expect(brush).not.toHaveValue(before);
  await page.mouse.up();
  await study.getByRole("button", { name: "Clear brushes" }).click();
  await expect(selected).toHaveText(original!);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const dot = await scatter
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i] !== 189 ||
          pixels[i + 1] !== 75 ||
          pixels[i + 2] !== 24 ||
          pixels[i + 3] !== 255
        )
          continue;
        const bounds = canvas.getBoundingClientRect();
        const pixel = i / 4;
        return {
          x: bounds.x + ((pixel % canvas.width) * bounds.width) / canvas.width,
          y:
            bounds.y +
            (Math.floor(pixel / canvas.width) * bounds.height) / canvas.height,
        };
      }
      return null;
    });
  expect(dot).not.toBeNull();
  await page.mouse.click(dot!.x, dot!.y);
  await expect(selected).toHaveText(/^1 selected/);
  await study.getByRole("button", { name: "Pareto", exact: true }).click();
  await expect(selected).toHaveText(/^1 selected/);
  await study
    .getByRole("button", { name: "Design table", exact: true })
    .click();
  const table = study.getByRole("region", { name: "Design table" });
  const first = await table.locator("tbody th button").first().textContent();
  await table.getByRole("button", { name: first! }).click();
  await expect(selected).toHaveText(/^1 selected/);
  const download = page.waitForEvent("download");
  await study.getByRole("button", { name: "Export selected CSV" }).click();
  const { data } = Papa.parse<Record<string, string>>(
    await readFile((await (await download).path())!, "utf8"),
    { header: true, skipEmptyLines: true },
  );
  expect(data).toHaveLength(1);
  expect(data[0].Design).toBe(first);
  expect(data[0].Evaluation).toBe("predicted");
  expect(Number(data[0]["Tip load (N)"])).toBe(110);
  expect(data[0].Failure).toBe("Passes");
  expect(Number(data[0]["Beam mass (kg)"])).toBeLessThan(1);
});

test("cancels a pending study fit and retries in a fresh worker", async ({
  page,
}) => {
  await loadDesignQuery(page);
  await page
    .getByRole("button", { name: "Start study from this query" })
    .click();
  const study = page.getByRole("tabpanel", {
    name: "Optimisation Study",
    exact: true,
  });
  const worker = /study\.worker(?:-|\.ts)/;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(worker, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await study
      .getByRole("button", { name: "Review and fit surrogates" })
      .click();
    await study
      .getByRole("button", { name: "Cancel study computation" })
      .click();
    await expect(study.getByRole("alert")).toContainText(
      "Calculation cancelled",
    );
  } finally {
    release();
    await page.unroute(worker);
  }
  await study
    .getByRole("button", { name: "Fit surrogates", exact: true })
    .click();
  await expect(
    study.getByRole("button", { name: "Search retained regions" }),
  ).toBeEnabled();
});

test("sampling keeps seeded draws and reuses compatible cantilever study models", async ({
  page,
}) => {
  await loadDesignQuery(page);
  await page
    .getByRole("button", { name: "Start study from this query" })
    .click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("button", { name: /fit.*surrogate/i }).click();
  await expect(page.getByRole("button", { name: /search/i })).toBeEnabled();
  await page.getByRole("tab", { name: "Sampling", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Sample count" }).fill("20");
  const baseZIP = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download samples ZIP" }).click();
  await page.getByRole("button", { name: "Generate samples" }).click();
  await page.getByText("Predict additional variables", { exact: true }).click();
  const inputs = page.getByRole("group", { name: "Prediction inputs" });
  const outputs = page.getByRole("group", { name: "Prediction outputs" });
  await outputs
    .getByRole("checkbox", { name: "Beam mass (kg)", exact: true })
    .check();
  await inputs.getByRole("checkbox", { name: /Tip load/ }).check();
  await page.getByRole("button", { name: "Fit or reuse surrogates" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await inputs.getByRole("checkbox", { name: /Tip load/ }).uncheck();
  await page.getByRole("button", { name: "Fit or reuse surrogates" }).click();
  await expect(page.getByText(/Study model ·/)).toBeVisible();
  await page.getByRole("button", { name: "Apply predictions" }).click();
  const predictedZIP = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download samples with predictions" })
    .click();
  const { unzipSync, strFromU8 } = await import("fflate");
  const readZip = async (event: typeof baseZIP) =>
    unzipSync(await readFile((await (await event).path())!));
  const base = await readZip(baseZIP);
  const prediction = await readZip(predictedZIP);
  const rows = (zip: typeof prediction) =>
    Papa.parse<string[]>(strFromU8(zip["samples.csv"]), {
      skipEmptyLines: true,
    }).data.slice(1);
  expect(rows(prediction).map((row) => row.slice(0, 3))).toEqual(rows(base));
  const manifest = JSON.parse(strFromU8(prediction["manifest.json"]));
  expect(manifest.surrogates[0].reused).toBe(true);
  expect(manifest.columns.at(-1).source).toBe("predicted");
});
