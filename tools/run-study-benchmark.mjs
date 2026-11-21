import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const pageUrl = new URL(
    "tools/study-benchmark.html",
    process.env.TEST_URL || "http://127.0.0.1:5173/",
  );
  await page.goto(pageUrl.href);
  await page.waitForFunction(
    () => typeof window.runStudyBenchmark === "function",
  );
  const session = await browser.newBrowserCDPSession();
  const pending = new Map();
  let message = 0;
  session.on("Target.receivedMessageFromTarget", ({ message: payload }) => {
    const { id, result } = JSON.parse(payload);
    pending.get(id)?.(result);
    pending.delete(id);
  });
  async function heap() {
    const targets = await session.send("Target.getTargets");
    const worker = targets.targetInfos.find(
      (t) => t.type === "worker" && t.url.includes("study-benchmark.worker"),
    );
    if (!worker) return;
    const { sessionId } = await session.send("Target.attachToTarget", {
      targetId: worker.targetId,
      flatten: false,
    });
    try {
      const id = ++message;
      const result = new Promise((resolve) => pending.set(id, resolve));
      await session.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id, method: "Runtime.getHeapUsage" }),
      });
      const timer = new Promise((resolve) =>
        setTimeout(() => {
          pending.delete(id);
          resolve(undefined);
        }, 100),
      );
      return await Promise.race([result, timer]);
    } finally {
      await session
        .send("Target.detachFromTarget", { sessionId })
        .catch(() => {});
    }
  }

  const report = [];
  for (const runtime of ["javascript", "wasm"]) {
    let running = true,
      peakWorkerBytes = 0;
    const monitor = (async () => {
      while (running) {
        const usage = await heap().catch(() => undefined);
        if (usage)
          peakWorkerBytes = Math.max(
            peakWorkerBytes,
            usage.usedSize + (usage.backingStorageSize ?? 0),
          );
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    })();
    const result = await page
      .evaluate((name) => window.runStudyBenchmark(name), runtime)
      .finally(() => {
        running = false;
      });
    await monitor;
    const cancellation = await page.evaluate(
      (name) => window.runStudyBenchmark(name, true),
      runtime,
    );
    report.push({ ...result, peakWorkerBytes, cancellation });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
