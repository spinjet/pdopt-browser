import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openExploration } from "./fixtures";

test("cantilever tutorial demonstrates bending failure and a mass-constrained design space", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  await page
    .getByRole("button", { name: "Help/Tutorial", exact: true })
    .click();
  const tutorial = page.getByRole("complementary", {
    name: "Help",
    exact: true,
  });
  await expect(
    tutorial.getByRole("heading", { name: "Data", exact: true }),
  ).toBeVisible();
  await tutorial
    .getByLabel("Help content")
    .selectOption({ label: "Cantilever tutorial" });
  await expect(
    tutorial.getByRole("heading", { name: "Cantilever beam tutorial" }),
  ).toBeVisible();
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
  const steps = tutorial.getByRole("region", { name: "Tutorial steps" });
  await steps.evaluate((el) => {
    el.scrollTop = 250;
  });
  await openExploration(page, "Queries");
  await expect(steps).toBeVisible();
  expect(await steps.evaluate((el) => el.scrollTop)).toBe(250);
  await tutorial
    .getByLabel("Help content")
    .selectOption({ label: "Help for this view" });
  await expect(
    tutorial.getByRole("heading", { name: "Queries" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(
    tutorial.getByRole("heading", { name: "Data", exact: true }),
  ).toBeVisible();
  await tutorial
    .getByLabel("Help content")
    .selectOption({ label: "Cantilever tutorial" });
  expect(await steps.evaluate((el) => el.scrollTop)).toBe(250);
  const widthControl = tutorial.getByRole("slider", { name: "Panel width" });
  const originalWidth = (await tutorial.boundingBox())!.width;
  await widthControl.press("ArrowRight");
  expect((await tutorial.boundingBox())!.width).toBeGreaterThan(originalWidth);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(widthControl).toBeHidden();
  await tutorial.getByRole("button", { name: "Close tutorial" }).click();
  await page
    .getByRole("button", { name: "Help/Tutorial", exact: true })
    .click();
  await expect(steps).toBeVisible();
  expect(await steps.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await tutorial.getByRole("button", { name: "Close tutorial" }).click();
  await expect(tutorial).not.toBeVisible();
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About PDOPT", exact: true });
  await expect(
    about.getByRole("heading", { name: "Theory", exact: true }),
  ).toBeVisible();
  await about.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Load cantilever beam example" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Cantilever example ready",
  );
  const rawData = page.getByRole("tabpanel", { name: "Data", exact: true });
  await expect(
    rawData.getByText("512 rows · 8 columns", { exact: true }),
  ).toBeVisible();
  await expect(
    rawData.getByRole("columnheader", { name: "Beam mass (kg)" }),
  ).toBeVisible();
  await openExploration(page, "States & training");
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Trained 8 CPTs from 512 rows",
  );
  await openExploration(page, "Queries");
  const evidence = page.getByRole("group", { name: "Query evidence" });
  const heatmap = page.locator(".joint-heatmap");
  await page.getByRole("tab", { name: "Design space", exact: true }).click();
  const queryNotation = page.locator("#queries-panel .query-notation");
  const resultNotation = page.locator("#results-panel .query-notation");
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
  await page.getByRole("button", { name: "Run selected query" }).click();
  await expect(resultNotation).toHaveText(conditional);
  await expect(resultNotation).toBeVisible();
  await page.getByRole("checkbox", { name: "Show values" }).check();
  const materialSlice = page
    .getByRole("region", { name: "Query results" })
    .getByRole("combobox", { name: "Material", exact: true });
  const design = (b: number, h: number) =>
    heatmap.locator(`[data-cell="${b}-${h}"]`);
  const probability = (b: number, h: number) =>
    expect.poll(async () =>
      parseFloat((await design(b, h).getAttribute("title")) ?? ""),
    );
  await expect(heatmap.getByRole("button")).toHaveCount(16);
  await materialSlice.selectOption({ label: "Aluminium" });
  await probability(0, 1).toBeGreaterThan(0);
  await probability(3, 3).toBe(0);
  await materialSlice.selectOption({ label: "Titanium" });
  await probability(0, 1).toBeGreaterThan(0);
  await materialSlice.selectOption({ label: "Steel" });
  await probability(1, 1).toBe(0);
  await page
    .getByRole("button", { name: "Export figure", exact: true })
    .click();
  const exportDialog = page.getByRole("dialog", {
    name: "Export query figure",
  });
  const sliceDownload = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download SVG" }).click();
  const sliceSvg = await readFile(
    (await (await sliceDownload).path())!,
    "utf8",
  );
  expect(sliceSvg).toContain("Material = Steel");
  expect(sliceSvg).toContain("Beam mass (kg) &lt; 1");
  expect(sliceSvg).not.toContain(
    "Joint probability of the displayed combinations",
  );
  await exportDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Heatmap palette" })
    .selectOption("Greens");
  await page.getByRole("spinbutton", { name: "Significant digits" }).fill("6");
  await page
    .getByRole("spinbutton", { name: "Significant digits" })
    .press("Tab");
  await page
    .getByRole("button", { name: "Export figure", exact: true })
    .click();
  await exportDialog
    .getByRole("combobox", { name: "Caption", exact: true })
    .selectOption("custom");
  await exportDialog
    .getByRole("textbox", { name: "Custom caption" })
    .fill("Steel geometry & mass");
  await exportDialog
    .getByRole("checkbox", { name: "Material = Steel" })
    .uncheck();
  const customDownload = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download SVG" }).click();
  const customSvg = await readFile(
    (await (await customDownload).path())!,
    "utf8",
  );
  expect(customSvg).toContain("Steel geometry &amp; mass");
  expect(customSvg).not.toContain("Material = Steel");
  expect(customSvg).toContain('stop-color="#f7fcf5"');
  const colorbarOnRight = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const colorbar = doc.querySelector("[data-colorbar]")!;
    return Array.from(doc.querySelectorAll("[data-cell]")).every(
      (cell) =>
        Number(cell.getAttribute("x")) + Number(cell.getAttribute("width")) <
        Number(colorbar.getAttribute("x")),
    );
  }, customSvg);
  expect(colorbarOnRight).toBe(true);
  await exportDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Network graph", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export network image", exact: true })
    .click();
  const networkExport = page.getByRole("dialog", {
    name: "Export network image",
  });
  const networkDownload = page.waitForEvent("download");
  await networkExport
    .getByRole("button", { name: "Download network image" })
    .click();
  const networkSvg = await readFile(
    (await (await networkDownload).path())!,
    "utf8",
  );
  const graph = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const nodes = Array.from(doc.querySelectorAll("g.node"));
    const material = nodes.find(
      (node) => node.querySelector("text")?.textContent === "Material",
    );
    const materialId = material?.querySelector("title")?.textContent;
    const materialEdges = Array.from(doc.querySelectorAll("g.edge")).filter(
      (edge) =>
        edge.querySelector("title")?.textContent?.startsWith(materialId + ":"),
    );
    const startXs = materialEdges.map((edge) =>
      Number(
        edge
          .querySelector("path")
          ?.getAttribute("d")
          ?.match(/^M(-?[\d.]+),/)?.[1],
      ),
    );
    const failure = nodes.find(
      (node) => node.querySelector("text")?.textContent === "Failure",
    );
    const lines = Array.from(failure?.querySelectorAll("text") ?? []).map(
      (line) => ({
        text: line.textContent,
        y: Number(line.getAttribute("y")),
        weight: line.getAttribute("font-weight"),
      }),
    );
    return {
      startXs,
      lines,
      edgeCount: doc.querySelectorAll("g.edge polygon").length,
    };
  }, networkSvg);
  expect(graph.startXs).toHaveLength(3);
  expect(new Set(graph.startXs).size).toBe(3);
  expect(graph.edgeCount).toBe(12);
  const [name, evidenceLine, firstState] = graph.lines;
  expect(name).toMatchObject({ text: "Failure", weight: "bold" });
  expect(evidenceLine.text).toContain("{Passes}");
  expect(firstState.text).toContain("Fails:");
  expect(firstState.y - evidenceLine.y).toBeGreaterThan(
    evidenceLine.y - name.y,
  );
  await networkExport
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit query" }).click();
  await page.getByRole("button", { name: "Duplicate query" }).click();
  await mass.locator("summary").click();
  await threshold.fill("2");
  await mass.getByRole("button", { name: "Apply threshold" }).click();
  await openExploration(page, "Results");
  const resultQuery = page
    .locator("#results-panel")
    .getByRole("combobox", { name: "Query", exact: true });
  await expect(
    page.getByText("Run a query to see its results here."),
  ).toBeVisible();
  await resultQuery.selectOption({ label: "Design space" });
  await expect(resultNotation).toHaveText(conditional);
  await resultQuery.selectOption({ label: "Design space (copy)" });
  await openExploration(page, "Queries");
  await page.getByRole("button", { name: "Run selected query" }).click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
  await materialSlice.selectOption({ label: "Steel" });
  await probability(1, 1).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Edit query" }).click();
  const file = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles(await (await file).path());
  await expect(page.getByRole("status")).toContainText(
    "Project and dataset opened",
  );
  await openExploration(page, "Queries");
  await page.getByRole("tab", { name: "Design space", exact: true }).click();
  await expect(queryNotation).toHaveText(conditional);
  await page
    .getByRole("tab", { name: "Design space (copy)", exact: true })
    .click();
  await expect(queryNotation).toHaveText(conditional.replace("< 1", "< 2"));
  await page.getByRole("button", { name: "Run selected query" }).click();
  await expect(resultNotation).toHaveText(conditional.replace("< 1", "< 2"));
  await materialSlice.selectOption({ label: "Steel" });
  await probability(1, 1).toBeGreaterThan(0);
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
  const dialog = page.getByRole("tabpanel", { name: "Data", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("columnheader")).toHaveCount(headers.length);
  const table = dialog.getByRole("region", { name: "Preview rows" });
  await table.scrollIntoViewIfNeeded();
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
  await openExploration(page, "Network");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Manage data", exact: true }).click();
  await expect(dialog).toBeVisible();
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
  const dialog = page.getByRole("tabpanel", { name: "Data", exact: true });
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
  await openExploration(page, "Network");
  await page.getByText("Add a manual node", { exact: true }).click();
  for (const label of ["Load", "Response"]) {
    await page.getByLabel("Variable name").fill(label);
    await page.getByRole("button", { name: "Add node", exact: true }).click();
    await page.getByRole("button", { name: "Edit states" }).click();
    await page
      .getByLabel("States (one per line)")
      .fill(Array.from({ length: 10 }, (_, i) => label + " " + i).join("\n"));
    await page.getByRole("button", { name: "Apply states" }).click();
    if (label === "Load") await openExploration(page, "Network");
  }
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.getByRole("status")).toContainText("Trained 2 CPTs");
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  await page
    .getByTestId("project-file")
    .setInputFiles((await (await projectDownload).path())!);
  await expect(page.getByRole("status")).toContainText(/opened/i);
  await openExploration(page, "Queries");
  await page
    .getByRole("group", { name: "Targets for active query" })
    .getByLabel("Response")
    .check();
  await page
    .getByRole("group", { name: "Query evidence" })
    .getByRole("combobox", { name: "Load", exact: true })
    .selectOption({ label: "Load 0" });
  await page.getByRole("button", { name: "Run selected query" }).click();

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
  await page
    .getByRole("button", { name: "Export figure", exact: true })
    .click();
  const figure = page.getByRole("dialog", { name: "Export query figure" });
  await expect(
    figure.getByRole("img", { name: "Preview of the exported query figure" }),
  ).toBeVisible();
  const svgDownload = page.waitForEvent("download");
  await figure.getByRole("button", { name: "Download SVG" }).click();
  const svg = await readFile((await (await svgDownload).path())!, "utf8");
  expect(svg.match(/data-cell=/g)).toHaveLength(100);
  expect(svg).toContain('width="180mm"');
  expect(svg).toContain("Response 9");
  await figure.getByRole("button", { name: "Close", exact: true }).click();
  await heatmap.locator('[data-cell="0-0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(heatmap.locator('[data-cell="0-1"]')).toBeFocused();
  await expect(page.locator(".heatmap-detail")).toContainText("10.0%");
  await page.getByLabel("Show values").check();
  await expect(heatmap.locator('[data-cell="9-9"]')).toHaveText("0%");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.locator(".combination-table tbody tr").first(),
  ).toContainText("10.0%");
  await page.getByRole("button", { name: "Network graph" }).click();
  await expect(heatmap).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Inference network" }),
  ).toBeVisible();
  const graph = page.locator("#results-panel .graph-wrap");
  const zoom = () =>
    graph
      .locator(".vue-flow__transformationpane")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect
    .poll(async () => (await graph.boundingBox())!.height)
    .toBeGreaterThan(300);
  const initialZoom = await zoom();
  const initialHeight = (await graph.boundingBox())!.height;
  await page.setViewportSize({ width: 1864, height: 1065 });
  await expect
    .poll(async () => (await graph.boundingBox())!.height)
    .toBeGreaterThan(initialHeight + 100);
  await expect.poll(zoom).toBeGreaterThan(initialZoom);
  await expect
    .poll(() =>
      page
        .locator("footer")
        .evaluate((el) => Math.round(el.getBoundingClientRect().bottom)),
    )
    .toBe(1065);
  const load = page
    .locator(".probability-node")
    .filter({ has: page.getByText("Load", { exact: true }) });
  await expect(load).toContainText("100%");
  await load.getByRole("button", { name: "All 10 states" }).click();
  await expect(load).toContainText("Load 9");
  await page
    .getByRole("button", { name: "Query results", exact: true })
    .click();
  await expect(page.locator(".combination-table")).toBeVisible();
  await page.getByRole("button", { name: "Edit query" }).click();
  await expect(
    page
      .getByRole("group", { name: "Query evidence" })
      .getByRole("combobox", { name: "Load", exact: true }),
  ).toHaveValue("0");
});

test("groups exploration views and remembers the selected view", async ({
  page,
}) => {
  await page.goto(process.env.TEST_PATH || "/");
  const workspace = page.getByRole("tablist", {
    name: "Workspace",
    exact: true,
  });
  const exploration = workspace.getByRole("tab", {
    name: "Probabilistic Exploration",
    exact: true,
  });
  const study = workspace.getByRole("tab", {
    name: "Optimisation Study",
    exact: true,
  });
  const views = page.getByRole("tablist", { name: "Exploration views" });
  await expect(workspace.getByRole("tab")).toHaveText([
    "Data",
    "Probabilistic Exploration",
    "Sampling",
    "Optimisation Study",
  ]);
  await expect(views).toBeHidden();
  await workspace
    .getByRole("tab", { name: "Data", exact: true })
    .press("ArrowRight");
  await expect(exploration).toBeFocused();
  await expect(views.getByRole("tab")).toHaveText([
    "Network",
    "States & training",
    "Queries",
    "Results",
  ]);
  const network = views.getByRole("tab", { name: "Network", exact: true });
  const results = views.getByRole("tab", { name: "Results", exact: true });
  await expect(network).toHaveAttribute("aria-selected", "true");
  await network.press("End");
  await expect(results).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Results", exact: true }),
  ).toBeVisible();
  await study.click();
  await expect(
    page.getByRole("tabpanel", { name: "Optimisation Study", exact: true }),
  ).toBeVisible();
  await expect(views).toBeHidden();
  await exploration.click();
  await expect(results).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await exploration.click();
  await expect(network).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 1864, height: 1074 });
  const editor = page.getByRole("region", { name: "Network editor" });
  const footer = page.locator("footer");
  await expect
    .poll(async () => {
      const canvas = (await editor.boundingBox())!;
      return Math.round(
        canvas.y + canvas.height - (await footer.boundingBox())!.y,
      );
    })
    .toBe(0);
  await page
    .getByRole("button", { name: "Help/Tutorial", exact: true })
    .click();
  const help = page.getByRole("complementary", { name: "Help", exact: true });
  await expect(
    help.getByRole("heading", { name: "Network", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Math.round(
        (await footer.boundingBox())!.y + (await footer.boundingBox())!.height,
      ),
    )
    .toBe(1074);
  await openExploration(page, "States & training");
  await expect(
    help.getByRole("heading", { name: "States & training", exact: true }),
  ).toBeVisible();
  await openExploration(page, "Results");
  await expect(
    help.getByRole("heading", { name: "Results · Query results" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Network graph", exact: true })
    .click();
  await expect(
    help.getByRole("heading", { name: "Results · Network graph" }),
  ).toBeVisible();
  await study.click();
  await expect(
    help.getByRole("heading", { name: "Optimisation Study · Setup" }),
  ).toBeVisible();
  await help.getByRole("button", { name: "Close tutorial" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(study).toBeInViewport({ ratio: 1 });
});
