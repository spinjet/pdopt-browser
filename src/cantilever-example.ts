import { randomGenerator } from "./numbers";

export const spanMm = 500;
export const sampleCount = 512;
export const cantileverInputs = [
  { min: 10, max: 50, cuts: [20, 30, 40] }, // width in mm
  { min: 10, max: 50, cuts: [20, 30, 40] }, // depth in mm
  { min: 50, max: 200, cuts: [87.5, 125, 162.5] }, // tip load in N
];
export const materials = [
  { name: "Steel", modulusMpa: 200_000, allowableMpa: 45, densityKgM3: 7850 },
  {
    name: "Aluminium",
    modulusMpa: 69_000,
    allowableMpa: 35,
    densityKgM3: 2700,
  },
  {
    name: "Titanium",
    modulusMpa: 114_000,
    allowableMpa: 55,
    densityKgM3: 4500,
  },
];

export const cantileverHeaders = [
  "Width (mm)",
  "Depth (mm)",
  "Tip load (N)",
  "Material",
  "Root stress (MPa)",
  "Tip deflection (mm)",
  "Failure",
  "Beam mass (kg)",
];
// Each material has its allowable at a bin boundary. None of the sampled
// stresses equals an allowable, so each (stress bin, material) has one outcome.
export const stressCutsMpa = [
  5,
  10,
  20,
  ...materials.map((m) => m.allowableMpa),
].sort((a, b) => a - b);
export const deflectionCutsMm = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 6];
export const massCutsKg = [0.5, 1, 2, 3, 5, 7.5];

function latinHypercube() {
  // This seed covers every parent-bin combination in the tutorial network.
  const random = randomGenerator(14129);
  const axes = [...cantileverInputs, { min: 0, max: 1 }];
  return axes.map(({ min, max }) => {
    const values = Array.from(
      { length: sampleCount },
      (_, i) => min + ((i + 0.5) / sampleCount) * (max - min),
    );
    // Independently shuffle each input so every stratum is used once.
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  });
}

/** Euler–Bernoulli bending of a solid rectangular beam with a free-end point load. */
export function evaluateCantilever(
  width: number,
  depth: number,
  load: number,
  material: (typeof materials)[number],
) {
  const inertia = (width * depth ** 3) / 12;
  const volumeM3 = (width * depth * spanMm) / 1e9;
  const stress = (load * spanMm * (depth / 2)) / inertia;
  return {
    stress,
    deflection: (load * spanMm ** 3) / (3 * material.modulusMpa * inertia),
    failure: stress > material.allowableMpa ? "Fails" : "Passes",
    massKg: material.densityKgM3 * volumeM3,
  };
}

export function cantileverCsv(): string {
  const rows = [cantileverHeaders.join(",")];
  const [widths, depths, loads, materialCoordinates] = latinHypercube();
  for (const [i, width] of widths.entries()) {
    const depth = depths[i],
      load = loads[i];
    const material =
      materials[Math.floor(materialCoordinates[i] * materials.length)];
    const { stress, deflection, failure, massKg } = evaluateCantilever(
      width,
      depth,
      load,
      material,
    );
    rows.push(
      [
        width,
        depth,
        load,
        material.name,
        stress.toFixed(6),
        deflection.toFixed(6),
        failure,
        massKg.toFixed(6),
      ].join(","),
    );
  }
  return rows.join("\n");
}
