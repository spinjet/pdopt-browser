# Browser-local study benchmark

The first study release uses the JavaScript random forest in a dedicated worker. The worker supports cancellation by termination. The Pyodide comparator runs in a separate, lazy-loaded benchmarking worker.

## Reproduce

From `web`, run `npm ci`, then `node tools/study-benchmark-assets.mjs`. The asset tool downloads the packages pinned in the Pyodide lock and verifies the wheel checksums. Start `npm run dev` and run `node tools/run-study-benchmark.mjs` in a second terminal. Set `CHROMIUM_PATH` to a Chromium executable or install a Playwright-managed browser. `TEST_URL` defaults to `http://127.0.0.1:5173/`.

The comparator uses `ml-random-forest@2.1.0` and scikit-learn 1.7.0 under Pyodide 0.29.5. Both use 24 trees and identical deterministic, roughly 80/20 held-out splits. The JavaScript release fits at most 768 sampled training rows per response to bound the cost of exhaustive tree splits. Scikit-learn fits all training rows. The ten-input synthetic case has three numeric responses and a pass/fail response. The cantilever uses the tutorial's 512 rows, mass and deflection objectives, and the failure response.

## Observed on Windows Chromium headless

| Metric                                           | JavaScript | Pyodide / scikit-learn |
| ------------------------------------------------ | ---------: | ---------------------: |
| Runtime initialisation inside worker             |    < 0.1 s |                10.14 s |
| Cantilever fit and held-out prediction, summed   |     1.16 s |                 0.24 s |
| 10,000-row fit and held-out prediction, summed   |    11.13 s |                 5.71 s |
| Peak sampled worker heap + backing storage       |     30 MiB |                190 MiB |
| Longest observed main-thread animation-frame gap |    16.8 ms |                16.8 ms |
| Worker termination during benchmark              |     Passed |                 Passed |

Heap figures are sampled V8 usage from Chromium DevTools. Timing is from one local run and includes computation and held-out prediction. The runtime initialisation timer starts after the worker's static imports. Fit times depend on the active browser and hardware.

| Held-out metric                             | JavaScript | Pyodide / scikit-learn |
| ------------------------------------------- | ---------: | ---------------------: |
| Beam mass MAE (kg)                          |      0.129 |                  0.154 |
| Beam tip-deflection MAE (mm)                |      0.976 |                  0.945 |
| Beam failure accuracy                       |      98.0% |                  96.0% |
| Beam missed failures out of 19              |          2 |                      3 |
| Beam missed mass violations out of 74       |          0 |                      2 |
| Synthetic mass proxy MAE                    |     0.0556 |                 0.0235 |
| Synthetic output B MAE                      |      0.217 |                  0.162 |
| Synthetic output C MAE                      |      0.116 |                 0.0547 |
| Synthetic missed mass violations out of 969 |         64 |                     30 |
| Synthetic missed failures out of 522        |        117 |                     70 |

The JavaScript model had the lower mass error and missed fewer violations on the beam pilot, with lower startup and memory costs. Scikit-learn improved every synthetic response on the larger study, where it used the full training split. The Run view exposes fitted row counts and missed violations so engineers can judge the chosen model for their data. The verified cantilever front is recomputed with the beam equations.
