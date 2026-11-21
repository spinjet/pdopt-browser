import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const source = "node_modules/pyodide";
const target = "study-benchmark-assets";
const lock = JSON.parse(
  await readFile(path.join(source, "pyodide-lock.json"), "utf8"),
);
const { version } = JSON.parse(
  await readFile(path.join(source, "package.json"), "utf8"),
);
const cdn = "https://cdn.jsdelivr.net/pyodide/v" + version + "/full/";
const packages = new Set();
function include(name) {
  if (packages.has(name)) return;
  packages.add(name);
  lock.packages[name].depends.forEach(include);
}
include("scikit-learn");
await mkdir(target, { recursive: true });
await Promise.all(
  [
    "pyodide-lock.json",
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
  ].map((file) => copyFile(path.join(source, file), path.join(target, file))),
);
await Promise.all(
  [...packages].map(async (name) => {
    const item = lock.packages[name];
    const file = path.join(target, item.file_name);
    const hash = (data) => createHash("sha256").update(data).digest("hex");
    const cached = await readFile(file).catch(() => undefined);
    if (cached && hash(cached) === item.sha256) return;
    const response = await fetch(cdn + item.file_name, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        "Could not download " + item.file_name + " (" + response.status + ").",
      );
    const body = Buffer.from(await response.arrayBuffer());
    if (hash(body) !== item.sha256)
      throw new Error("Package checksum mismatch for " + item.file_name);
    await writeFile(file, body);
  }),
);
console.log("Pyodide and scikit-learn benchmark assets are ready.");
