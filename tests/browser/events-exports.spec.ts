import Papa from "papaparse";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { openDiscreteFixture, openExploration } from "./fixtures";
const base = process.env.TEST_PATH || "/";
async function init(page: Page) {
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.getByTestId("csv-file").setInputFiles({
    name: "events.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Temperature,Output\n0,no\n5,no\n10,yes\n15,yes\n20,yes\n",
    ),
  });
  await openExploration(page, "Network");
  for (const label of ["Temperature", "Output"])
    await page
      .getByRole("button", { name: `Add ${label}`, exact: true })
      .click();
  await openExploration(page, "States & training");
  await page
    .getByRole("combobox", { name: "Selected variable", exact: true })
    .selectOption({ label: "Temperature" });
  await page
    .getByRole("combobox", { name: "Binning method", exact: true })
    .selectOption("manual");
  await page
    .getByRole("textbox", { name: "Thresholds (comma-separated)", exact: true })
    .fill("5, 15");
  await page.getByRole("button", { name: "Apply variable settings" }).click();
  await expect(
    page.getByText("3 EFFECTIVE STATES", { exact: true }),
  ).toBeVisible();
  await openExploration(page, "Network");
}
async function train(page: Page) {
  await openExploration(page, "States & training");
  await expect(page.getByText("5 rows retained · 0 excluded")).toBeVisible();
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Trained 2 CPTs");
}
async function run(page: Page) {
  await openExploration(page, "Queries");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(
    page.getByText("Current results", { exact: true }),
  ).toBeVisible();
}
test("four-side connections, exact numeric events, image and dependent sample downloads remain local", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== "127.0.0.1")
      external.push(r.url());
  });
  await init(page);
  const handles = page
    .locator("#network-panel .vue-flow__node")
    .first()
    .locator(".vue-flow__handle");
  await expect(handles).toHaveCount(4);
  await page.getByText("Connections · keyboard controls").click();
  const c = page.locator(".connection-controls");
  await c
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Temperature" });
  await c
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Output" });
  await c
    .getByRole("combobox", { name: "From side", exact: true })
    .selectOption("top");
  await c
    .getByRole("combobox", { name: "To side", exact: true })
    .selectOption("bottom");
  await c.getByRole("button", { name: "Connect", exact: true }).click();
  await openExploration(page, "States & training");
  await train(page);
  await openExploration(page, "Queries");
  const targets = page.getByRole("group", {
    name: "Targets for active query",
    exact: true,
  });
  await targets.getByLabel("Output", { exact: true }).check();
  const event = page.locator(".evidence-control").first();
  await event.locator("summary").click();
  await event
    .getByRole("spinbutton", { name: "Threshold for Temperature", exact: true })
    .fill("7");
  await event.getByRole("button", { name: "Apply threshold" }).click();
  await expect(
    page.getByRole("button", { name: "Run query", exact: true }),
  ).toBeDisabled();
  await event.getByRole("button", { name: "Add exact cut & retrain" }).click();
  await expect(
    page
      .getByText("Train CPTs for the current model before inference.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await train(page);
  await run(page);
  await page
    .getByRole("button", { name: "Network graph", exact: true })
    .click();
  const graph = page.getByRole("region", { name: "Inference network" });
  const edge = graph.locator(".vue-flow__edge-path");
  await expect(edge).toBeVisible();
  const marker = graph.locator("marker");
  const markerId = await marker.getAttribute("id");
  expect(markerId).toMatch(/^inference__/);
  await expect(edge).toHaveAttribute("marker-end", `url('#${markerId}')`);
  await expect(
    page.locator("#results-panel .network-node").first(),
  ).toContainText("0.0%");
  await page
    .getByRole("button", { name: "Query results", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sample distribution", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Sample count", exact: true })
    .fill("100");
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download samples ZIP" }).click();
  const zip = unzipSync(await readFile((await (await zipPromise).path())!));
  const meta = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(meta.count).toBe(100);
  expect(meta.evidence[meta.columns[0].variableId]).toMatchObject({
    kind: "threshold",
    value: 7,
  });
  expect(strFromU8(zip["samples.csv"]).split("\r\n")).toHaveLength(101);
  await page
    .getByRole("button", { name: "Generate samples", exact: true })
    .click();
  const analytics = page.getByRole("region", { name: "Sample analytics" });
  await expect(analytics.getByRole("status")).toContainText("100 of 100");
  await expect(
    analytics.getByRole("region", { name: "Query sample scatter" }),
  ).toBeVisible();
  await analytics
    .getByRole("button", { name: "Parallel coordinates", exact: true })
    .click();
  await expect(
    analytics.locator("canvas[aria-label='Parallel coordinates chart']"),
  ).toBeVisible();
  await analytics
    .getByRole("button", { name: "Sample table", exact: true })
    .click();
  await analytics
    .getByRole("button", { name: "Select sample 1", exact: true })
    .click();
  await expect(analytics.getByRole("status")).toContainText("1 of 100");
  const csvPromise = page.waitForEvent("download");
  await analytics.getByRole("button", { name: "Export selected CSV" }).click();
  const selectedCsv = await readFile(
    (await (await csvPromise).path())!,
    "utf8",
  );
  const parseCsv = (str: string) =>
    Papa.parse<string[]>(str, { skipEmptyLines: true }).data;
  expect(parseCsv(selectedCsv)).toEqual(
    parseCsv(strFromU8(zip["samples.csv"])).slice(0, 2),
  );
  const [[temperature]] = parseCsv(selectedCsv).slice(1);
  expect(Number(temperature)).toBeGreaterThanOrEqual(7);
  expect(Number(temperature)).toBeLessThanOrEqual(20);
  expect(Number.isInteger(Number(temperature))).toBe(false);
  await analytics
    .getByRole("button", { name: "Scatter plot", exact: true })
    .click();
  await expect(analytics.getByRole("status")).toContainText("1 of 100");
  await page
    .getByRole("button", { name: "Network graph", exact: true })
    .click();
  await graph
    .getByRole("button", { name: "Export network image", exact: true })
    .click();
  const exportDialog = page.getByRole("dialog", {
    name: "Export network image",
  });
  const preview = exportDialog.getByRole("img", {
    name: "Preview of the exported network image",
  });
  await expect(preview).toBeVisible();
  await exportDialog.getByLabel("Evidence nodes").fill("#ffd480");
  await exportDialog.getByLabel("Query target nodes").fill("#94d5f5");
  const svgPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download network image" }).click();
  const svg = await readFile((await (await svgPromise).path())!, "utf8");
  expect(svg).toContain("<svg");
  expect(svg).toContain("%");
  expect(svg).toContain('fill="#ffd480"');
  expect(svg).toContain('fill="#94d5f5"');
  expect(svg).toContain('font-weight="bold"');
  expect(
    decodeURIComponent((await preview.getAttribute("src"))!.split(",")[1]),
  ).toBe(svg);
  expect(svg).not.toContain("__event_");
  await page
    .getByRole("combobox", { name: "Image format", exact: true })
    .selectOption("png");
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download network image" }).click();
  const png = await readFile((await (await pngPromise).path())!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await exportDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const savePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await savePromise).path())!, "utf8"),
  );
  expect(saved.schemaVersion).toBe(3);
  expect(saved.edges[0]).toMatchObject({
    sourceHandle: "top",
    targetHandle: "bottom",
  });
  expect(external).toEqual([]);
});
test("categorical allowed-state selection invalidates old results and can be cleared", async ({
  page,
}) => {
  await page.goto(base);
  await openDiscreteFixture(page);
  await openExploration(page, "States & training");
  await page.getByRole("button", { name: "Train model", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Trained 3 CPTs");
  await run(page);
  await openExploration(page, "Queries");
  const event = page.locator(".evidence-control").first();
  await event.locator("summary").click();
  await event.getByRole("listbox").selectOption(["0", "1"]);
  await openExploration(page, "Results");
  await expect(page.getByText(/Outdated results/)).toBeVisible();
  await run(page);
  await openExploration(page, "Queries");
  await event.getByRole("listbox").selectOption(["1"]);
  await run(page);
  await openExploration(page, "Queries");
  await page
    .getByRole("button", { name: "Clear evidence", exact: true })
    .click();
  await run(page);
});

test("top-to-bottom pointer connections preserve parent-to-child direction", async ({
  page,
}) => {
  await init(page);
  const nodes = page.locator("#network-panel .vue-flow__node");
  const source = await nodes
      .nth(0)
      .locator(".vue-flow__handle-top")
      .boundingBox(),
    target = await nodes
      .nth(1)
      .locator(".vue-flow__handle-bottom")
      .boundingBox();
  expect(source).toBeTruthy();
  expect(target).toBeTruthy();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 20 },
  );
  await page.mouse.up();
  await expect(page.locator("#network-panel .vue-flow__edge")).toHaveCount(1);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await save).path())!, "utf8"),
  );
  expect(saved.edges[0]).toMatchObject({
    source: saved.variables[0].id,
    target: saved.variables[1].id,
    sourceHandle: "top",
    targetHandle: "bottom",
  });
});
for (const operation of ["graph", "sample"] as const)
  test(`${operation} export cancellation or stale response preserves inference and permits retry`, async ({
    page,
  }) => {
    await page.goto(base);
    await openDiscreteFixture(page);
    await openExploration(page, "States & training");
    await page
      .getByRole("button", { name: "Train model", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Trained 3 CPTs");
    await run(page);
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      requested = new Promise<void>((r) => (started = r));
    const pattern =
      operation === "graph" ? "**/graph-export-*.js" : "**/sampling-*.js";
    await page.route(pattern, async (route) => {
      started();
      await barrier;
      await route.continue().catch(() => {});
    });
    const exportDialog = page.getByRole("dialog", {
      name: "Export network image",
    });
    const button = page.getByRole("button", {
      name:
        operation === "graph"
          ? "Download network image"
          : "Download samples ZIP",
      exact: true,
    });
    if (operation === "graph") {
      await page
        .getByRole("button", { name: "Network graph", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Export network image", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Sample distribution", exact: true })
        .click();
      await button.click();
    }
    await requested;
    if (operation === "graph")
      await exportDialog
        .getByRole("button", { name: "Cancel computation", exact: true })
        .click();
    else {
      await openExploration(page, "Queries");
      await page
        .getByRole("group", { name: "Query evidence", exact: true })
        .getByRole("combobox", { name: "Load", exact: true })
        .selectOption({ label: "High" });
    }
    release();
    const error = (operation === "graph" ? exportDialog : page).getByRole(
      "alert",
    );
    await expect(error).toContainText(
      operation === "graph" ? "cancelled" : "outdated",
    );
    await page.unroute(pattern);
    await expect(page.locator("#results-panel .network-node")).toHaveCount(3);
    if (operation === "sample") {
      await run(page);
      await page
        .getByRole("button", { name: "Sample distribution", exact: true })
        .click();
    } else
      await exportDialog.getByRole("button", { name: "Retry preview" }).click();
    const download = page.waitForEvent("download");
    await button.click();
    expect((await download).suggestedFilename()).toBe(
      operation === "graph" ? "pdopt-bn-network.svg" : "pdopt-bn-samples.zip",
    );
  });

test("selected connections can be deleted visibly and with the keyboard, and deletion persists", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await openDiscreteFixture(page);
  const edges = page.locator("#network-panel .vue-flow__edge");
  await expect(edges).toHaveCount(2);
  const remove = page.getByRole("button", {
    name: "Delete selected connection",
    exact: true,
  });
  async function selectFirstEdge() {
    const path = edges.first().locator(".vue-flow__edge-interaction");
    await path.scrollIntoViewIfNeeded();
    const { x, y } = await path.evaluate((element: SVGPathElement) => {
      const midpoint = element.getPointAtLength(element.getTotalLength() / 2);
      const screen = midpoint.matrixTransform(element.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(x, y);
  }
  await expect(remove).toBeDisabled();
  await selectFirstEdge();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(edges).toHaveCount(1);
  await selectFirstEdge();
  await page.keyboard.press("Delete");
  await expect(edges).toHaveCount(0);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await save).path())!, "utf8"),
  );
  expect(saved.edges).toEqual([]);
  expect(saved.variables).toHaveLength(3);
});

test("auto layout and export use vertical hierarchy for bottom/top connections", async ({
  page,
}) => {
  await init(page);
  await page.getByText("Connections · keyboard controls").click();
  const controls = page.locator(".connection-controls");
  await controls
    .getByRole("combobox", { name: "From", exact: true })
    .selectOption({ label: "Temperature" });
  await controls
    .getByRole("combobox", { name: "To", exact: true })
    .selectOption({ label: "Output" });
  await controls
    .getByRole("combobox", { name: "From side", exact: true })
    .selectOption("bottom");
  await controls
    .getByRole("combobox", { name: "To side", exact: true })
    .selectOption("top");
  await controls.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Auto layout", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Auto layout", exact: true }),
  ).toBeEnabled();
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await projectDownload).path())!, "utf8"),
  );
  const [parentNode, childNode] = saved.variables;
  expect(parentNode.position.y).toBeLessThan(childNode.position.y);
  expect(parentNode.position.x).toBe(childNode.position.x);
  await page
    .getByRole("region", { name: "Network editor" })
    .getByRole("button", { name: "Export network image", exact: true })
    .click();
  const direction = page.getByRole("combobox", {
    name: "Layout direction",
    exact: true,
  });
  await expect(direction).toHaveValue("auto");
  for (const flow of ["auto", "BT"]) {
    await direction.selectOption(flow);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download network image", exact: true })
      .click();
    const svg = await readFile((await (await download).path())!, "utf8");
    const positions = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      return Array.from(doc.querySelectorAll("g.node")).map((g) => ({
        id: g.querySelector("title")!.textContent,
        y: Number(g.querySelector("text")!.getAttribute("y")),
      }));
    }, svg);
    const parent = positions.find((n) => n.id === "n0")!.y,
      child = positions.find((n) => n.id === "n1")!.y;
    if (flow === "auto") expect(parent).toBeLessThan(child);
    else expect(parent).toBeGreaterThan(child);
  }
});
