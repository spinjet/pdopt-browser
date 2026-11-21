import { expect, test } from "@playwright/test";

test("cantilever tutorial demonstrates bending failure and a mass-constrained design space", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  await page
    .getByRole("button", { name: "Cantilever tutorial", exact: true })
    .click();
  const tutorial = page.getByRole("dialog", {
    name: "Cantilever beam tutorial",
  });
  const diagram = tutorial.getByRole("img", { name: /Cantilever schematic/ });
  await expect(diagram).toBeVisible();
  await expect
    .poll(() => diagram.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(680);
  await expect(
    tutorial.getByRole("heading", { name: "Calculations", exact: true }),
  ).toBeVisible();
  await expect(
    tutorial.getByRole("row").filter({ hasText: "Aluminium" }),
  ).toContainText("35");
  await expect(
    tutorial.getByRole("heading", { name: "Find a feasible design space" }),
  ).toBeVisible();
  await expect(tutorial).toContainText(
    "The Bayesian Network represents the cause-effect connection between the variables",
  );
  await expect(tutorial).toContainText("512 Latin hypercube samples");
  await tutorial.getByRole("button", { name: "Close tutorial" }).click();
  await expect(tutorial).not.toBeVisible();
  await page
    .getByRole("button", { name: "Load cantilever beam example" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Cantilever example ready",
  );
  await expect(
    page.getByText("512 rows · 8 columns", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview raw data" }).click();
  const rawData = page.getByRole("dialog", { name: "Raw data preview" });
  await expect(
    rawData.getByRole("columnheader", { name: "Beam mass (kg)" }),
  ).toBeVisible();
  await rawData.getByRole("button", { name: "Close preview" }).click();
  await page
    .getByRole("tab", { name: "States & training", exact: true })
    .click();
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Trained 8 CPTs from 512 rows",
  );
  await page.getByRole("tab", { name: "Queries", exact: true }).click();
  const evidence = page.getByRole("group", { name: "Shared evidence" });
  const heatmap = page.locator(".joint-heatmap");
  await page.getByRole("tab", { name: "Design space", exact: true }).click();
  const queryNotation = page.locator("#queries-panel .query-notation");
  const resultNotation = page.locator("#results-panel .query-notation");
  const applySaved = page.getByRole("button", { name: "Apply saved evidence" });
  await expect(queryNotation).toHaveText(
    "P ( Width (mm), Depth (mm), Material )",
  );
  await applySaved.click();
  const conditional =
    "P ( Width (mm), Depth (mm), Material | Tip load (N) = [87.50, 125.00), Failure = Passes, Beam mass (kg) < 1 )";
  await expect(queryNotation).toHaveText(conditional);
  const mass = evidence.locator(".evidence-control").filter({
    has: page.getByRole("combobox", { name: "Beam mass (kg)", exact: true }),
  });
  await mass.locator("summary").click();
  const threshold = mass.getByRole("spinbutton", {
    name: "Threshold for Beam mass (kg)",
  });
  await expect(threshold).toHaveValue("1");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(resultNotation).toHaveText(conditional);
  await expect(resultNotation).toBeVisible();
  await page.getByRole("checkbox", { name: "Show values" }).check();
  const materialSlice = page
    .getByRole("region", { name: "Query results" })
    .getByRole("combobox", { name: "Material", exact: true });
  const design = (b: number, h: number) =>
    heatmap.locator(`[data-cell="${b}-${h}"]`);
  const probability = (b: number, h: number) =>
    expect.poll(async () => Number(await design(b, h).getAttribute("title")));
  await expect(heatmap.getByRole("button")).toHaveCount(16);
  await materialSlice.selectOption({ label: "Aluminium" });
  await probability(0, 1).toBeGreaterThan(0);
  await probability(3, 3).toBe(0);
  await materialSlice.selectOption({ label: "Titanium" });
  await probability(0, 1).toBeGreaterThan(0);
  await materialSlice.selectOption({ label: "Steel" });
  await probability(1, 1).toBe(0);
  await page.getByRole("button", { name: "Edit query" }).click();
  await threshold.fill("2");
  await mass.getByRole("button", { name: "Apply threshold" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await materialSlice.selectOption({ label: "Steel" });
  await probability(1, 1).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Edit query" }).click();
  await page.getByRole("button", { name: "Save evidence with query" }).click();
  const file = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles(await (await file).path());
  await expect(page.getByRole("status")).toContainText("Project opened");
  await page.getByRole("tab", { name: "Queries", exact: true }).click();
  await page.getByRole("tab", { name: "Design space", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear evidence", exact: true })
    .click();
  await expect(queryNotation).toHaveText(
    "P ( Width (mm), Depth (mm), Material )",
  );
  await applySaved.click();
  await expect(queryNotation).toHaveText(conditional.replace("< 1", "< 2"));
});

test("wide raw data scrolls to the last row and column while keeping headers visible", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  const headers = Array.from(
    { length: 30 },
    (_, index) => `Column ${index + 1}`,
  );
  const rows = Array.from({ length: 200 }, (_, i) =>
    headers.map((_, j) => `R${i + 1} C${j + 1}`).join(","),
  );
  await page.getByTestId("csv-file").setInputFiles({
    name: "wide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([headers.join(","), ...rows].join("\n")),
  });
  const preview = page.getByRole("button", { name: "Preview raw data" });
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Raw data preview" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("columnheader")).toHaveCount(headers.length);
  const table = dialog.getByRole("region", { name: "Preview rows" });
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await table.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    dialog.getByRole("columnheader", { name: "Column 30", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("cell", { name: "R200 C30", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("cell", { name: "R1 C1", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(preview).toBeFocused();
});

test("raw data beyond the first 100,000 rows is accessible by row range", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  await page.getByTestId("csv-file").setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Index,Value\n" + "1,a\n".repeat(100_000) + "100001,last sample\n",
    ),
  });
  await page.getByRole("button", { name: "Preview raw data" }).click();
  const dialog = page.getByRole("dialog", { name: "Raw data preview" });
  const range = dialog.getByRole("combobox", { name: "Row range" });
  await range.selectOption("1");
  await expect(
    dialog.getByRole("cell", { name: "last sample" }),
  ).toBeInViewport();
  await range.selectOption("0");
  await expect(dialog.getByRole("cell", { name: "last sample" })).toHaveCount(
    0,
  );
});

test("a 10 by 10 result fits on a laptop and shares probabilities with the network", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(process.env.TEST_PATH || "/");
  await page.getByText("Add a manual node", { exact: true }).click();
  for (const label of ["Load", "Response"]) {
    await page.getByLabel("Variable name").fill(label);
    await page.getByRole("button", { name: "Add node", exact: true }).click();
    await page.getByRole("button", { name: "Edit states" }).click();
    await page
      .getByLabel("States (one per line)")
      .fill(Array.from({ length: 10 }, (_, i) => label + " " + i).join("\n"));
    await page.getByRole("button", { name: "Apply states" }).click();
    if (label === "Load")
      await page.getByRole("tab", { name: "Network", exact: true }).click();
  }
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.getByRole("status")).toContainText("Trained 2 CPTs");
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles((await (await projectDownload).path())!);
  await expect(page.getByRole("status")).toContainText(/opened/i);
  await page.getByRole("tab", { name: "Queries", exact: true }).click();
  await page
    .getByRole("group", { name: "Targets for active query" })
    .getByLabel("Response")
    .check();
  await page
    .getByRole("group", { name: "Shared evidence" })
    .getByRole("combobox", { name: "Load", exact: true })
    .selectOption({ label: "Load 0" });
  await page.getByRole("button", { name: "Run query" }).click();

  const heatmap = page.locator(".joint-heatmap");
  await expect(heatmap.getByRole("button")).toHaveCount(100);
  await expect(heatmap).toBeInViewport({ ratio: 1 });
  const scroll = page.locator(".heatmap-scroll");
  expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    await scroll.evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await heatmap.locator('[data-cell="0-0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(heatmap.locator('[data-cell="0-1"]')).toBeFocused();
  await expect(page.locator(".heatmap-detail")).toContainText("10.000%");
  await page.getByLabel("Show values").check();
  await expect(heatmap.locator('[data-cell="9-9"]')).toHaveText("0.000%");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.locator(".combination-table tbody tr").first(),
  ).toContainText("10.000%");
  await page.getByRole("button", { name: "Network graph" }).click();
  await expect(heatmap).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Inference network" }),
  ).toBeVisible();
  const load = page
    .locator(".probability-node")
    .filter({ has: page.getByText("Load", { exact: true }) });
  await expect(load).toContainText("100.0%");
  await load.getByRole("button", { name: "All 10 states" }).click();
  await expect(load).toContainText("Load 9");
  await page
    .getByRole("button", { name: "Query results", exact: true })
    .click();
  await expect(page.locator(".combination-table")).toBeVisible();
  await page.getByRole("button", { name: "Edit query" }).click();
  await expect(
    page
      .getByRole("group", { name: "Shared evidence" })
      .getByRole("combobox", { name: "Load", exact: true }),
  ).toHaveValue("0");
});
