import { expect, type Page } from "@playwright/test";
import { emptyProject } from "../../src/domain";
import { configureVariable, parseCsv } from "../../src/processing";

/** Small discrete network used by tests that assert specific posterior values. */
export async function openDiscreteFixture(page: Page) {
  const csv = [
    "Load,Material,Failure",
    "Low,Steel,No",
    "Low,Steel,No",
    "Low,Aluminium,No",
    "Low,Aluminium,Yes",
    "High,Steel,No",
    "High,Steel,Yes",
    "High,Aluminium,Yes",
    "High,Aluminium,Yes",
  ].join("\n");
  const project = emptyProject();
  const dataset = await parseCsv(
    csv,
    "discrete-fixture.csv",
    ",",
    project.missingTokens,
  );
  project.dataset = {
    name: dataset.name,
    hash: dataset.hash,
    headers: dataset.headers,
    rowCount: dataset.rows.length,
    delimiter: dataset.delimiter,
    embeddedCsv: csv,
  };
  project.variables = dataset.headers.map((_, index) =>
    configureVariable(
      dataset,
      project,
      `c${index}`,
      "categorical",
      "equalWidth",
      3,
      [],
    ),
  );
  const [load, material, failure] = project.variables;
  load.position = { x: 75, y: 55 };
  material.position = { x: 75, y: 255 };
  failure.position = { x: 450, y: 155 };
  project.edges = [load, material].map((input) => ({
    id: crypto.randomUUID(),
    source: input.id,
    target: failure.id,
    sourceHandle: "right",
    targetHandle: "left",
  }));
  project.queryGroups = [
    { id: crypto.randomUUID(), name: "Load", targetIds: [load.id] },
  ];
  await page.getByTestId("project-file").setInputFiles({
    name: "discrete-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(
    page.getByText("Project and dataset opened.", { exact: true }),
  ).toBeVisible();
}
