# Browser-local study benchmarks

## Release 3

Run `npm ci`, `node tools/study-benchmark-assets.mjs`, then `npm run dev`. In another terminal run `CHROMIUM_PATH=/usr/bin/chromium node tools/run-study-benchmark.mjs`. The asset tool verifies the Pyodide wheels against the lockfile. The application uses the local JavaScript implementation and loads no Python packages during a study.

The benchmark uses seed 4921 to split original designs before response-specific filtering. It scores 102 held-out designs from the 512-row cantilever and 2,000 from the 10,000-row mixed-input dataset. The matched comparisons use the same seeded sample of 128 training rows. Production forest and response surfaces use up to 768 rows and production GP uses up to 128. Classifiers stay on random forest. Timings below are from one Linux headless Chromium run.

| Dataset / response               | Forest / 128 MAE | Linear / 128 MAE | Quadratic / 128 MAE | GP / 128 MAE | GP nominal 95% interval coverage |
| -------------------------------- | ---------------: | ---------------: | ------------------: | -----------: | -------------------------------: |
| Cantilever / Tip deflection (mm) |            1.422 |            2.815 |               1.836 |        1.079 |                            75.5% |
| Cantilever / Beam mass (kg)      |           0.2486 |           0.4832 |              0.1039 |      0.03319 |                           100.0% |
| Synthetic 10,000 / Mass proxy    |          0.09253 |          0.07958 |           2.074e-08 |      0.05034 |                            99.6% |
| Synthetic 10,000 / Output B      |           0.2776 |           0.2833 |              0.2517 |       0.2202 |                            87.5% |
| Synthetic 10,000 / Output C      |           0.2204 |             0.26 |           4.179e-08 |       0.1449 |                            96.0% |

| Dataset / response               | Forest production rows / MAE | Linear production rows / MAE | Quadratic production rows / MAE | Missed violations, forest / GP |
| -------------------------------- | ---------------------------: | ---------------------------: | ------------------------------: | -----------------------------: |
| Cantilever / Tip deflection (mm) |                  410 / 1.001 |                  410 / 3.093 |                     410 / 2.261 |                              — |
| Cantilever / Beam mass (kg)      |                 410 / 0.1269 |                 410 / 0.4635 |                   410 / 0.09962 |                    0 / 1 of 74 |
| Synthetic 10,000 / Mass proxy    |                768 / 0.05667 |                768 / 0.07724 |                 768 / 9.321e-10 |                 64 / 67 of 969 |
| Synthetic 10,000 / Output B      |                 768 / 0.2276 |                 768 / 0.2658 |                    768 / 0.1631 |                              — |
| Synthetic 10,000 / Output C      |                 768 / 0.1108 |                 768 / 0.2584 |                 768 / 2.597e-09 |                              — |

| GP runtime | Cold startup (s) | Peak sampled worker heap and backing storage (MiB) | Fit per response (ms) | 2,048 candidate means (ms) | 2,048 means and deviations (ms) | Worker termination |
| ---------- | ---------------: | -------------------------------------------------: | --------------------: | -------------------------: | ------------------------------: | ------------------ |
| javascript |             0.00 |                                               11.5 |               2.1–8.2 |                  10.6–14.0 |                      51.9–102.2 | Passed             |
| wasm       |             9.45 |                                              206.6 |              4.5–25.4 |                  19.7–27.0 |                       18.7–27.3 | Passed             |

The [scikit-learn prototype](https://scikit-learn.org/stable/modules/gaussian_process.html) uses standardized input features and response, an RBF kernel with length scale equal to the square root of the encoded width, diagonal regularization of 0.025, and fixed hyperparameters. The browser GP matches the prototype's reported MAE and coverage for all five continuous responses at this fit size. Its search uses conditional model means for constraints. Nominal 95% intervals use mean ± 1.96 standard deviations. Coverage varied by response, especially for beam deflection, and the interval does not propagate upstream uncertainty. The application shows holdout coverage and restricts GP to the tested envelope of 128 fitted rows, 12 encoded predictors and 10,000 source rows. The cancellation checks terminate the worker at fit start for each offered JavaScript estimator and the scikit-learn prototype. Browser measurements vary with hardware and worker initialization.

## Historical forest-only comparison (Windows Chromium headless)

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

The JavaScript model had the lower mass error and missed fewer violations on the beam pilot, with lower startup and memory costs. Scikit-learn improved every synthetic response on the larger study, where it used the full training split. The Run view exposes fitted row counts and missed violations so engineers can judge the chosen model for their data.
