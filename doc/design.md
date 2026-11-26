# Sampling, surrogates, and optimisation

[Documentation index](README.md)

## Joint posterior samples

Make a cumulative sum over the joint grid in target order. A seeded Mulberry32 generator draws a uniform number, and a binary search selects the first cumulative boundary above it. This preserves dependencies among queried states. Categorical draws use state display labels. Finite numeric draws use their corresponding values. Conditional on the chosen state combination, each discretised coordinate is uniform inside the intersection of its bin and finite sampling limits. An open internal upper endpoint is moved to the preceding representable number. Sampling rejects limits that exclude a positive-mass state instead of implicitly renormalising the distribution. With the same ordered query, seed, bounds, and posterior, draws are reproducible.

Interactive plots support up to 5,000 draws. The base ZIP supports up to 100,000 rows subject to its size limit. Charts, brushing and the table share row identities. With additional predictions, the exported manifest records sampled, fixed and predicted columns, the query, source hash, seed, bounds, and model validation. Predicted values are point estimates. Variation across rows tracks variation in the input designs and supplies no estimate of the forest’s residual uncertainty.

## Surrogate fitting

Both workspaces use [the same response model](../src/study-model.ts). Pick CSV-backed predictors and responses. Each categorical predictor is expanded into one binary indicator per source category. Numeric predictors use their original values in one feature. Missing, unknown and out-of-bound entries are dropped for the response and its selected predictors. Sampling predictors come from the drawn row or a user-supplied fixed value.

- Numeric responses use random forest regression. A finite numeric response is projected onto the nearest declared state, with the lower state used in a tie.
- Categorical responses use random forest classification. Class indices are converted to their original source categories before presentation.
- The seeded split (4921) takes about 20% of each applicable stratum for holdout and preserves singleton classes in training. A fit needs eight complete rows, four training rows, and a nonempty holdout. The seeded forest (491) uses a maximum of 768 training rows, with at least one row per class selected before the remaining training sample for classification. It uses 24 trees, sample bagging, all encoded features, maximum depth 12, and minimum node sample count 3. A constant training response uses a constant predictor.
- Accuracy is the share of correct held-out classes. Mean absolute error is `Σ|y − ŷ| / n`. Relative MAE divides by the range of observed holdout values when that range is positive. Study reports also count observed constraint violations a model missed. For a numeric threshold, the near-threshold band is 10% of the absolute threshold with a floor of machine epsilon.
- An in-memory fitted study model is eligible for reuse when the dataset hash, missing tokens, ordered predictors, response, and encodings match. Both paths use the same model settings. A fit for an unsupported response can fail while other responses succeed.

## Posterior coverage and search

A study starts from an immutable joint-query snapshot. Each joint cell represents a combination of target states. The study intersects the cell’s ranges with selected design limits, filters categorical choices, and checks exact fixed values. A cell is eligible when these intersections are nonempty and the cell has positive posterior probability.

Sort eligible cells by descending posterior mass. Take cells until the sum meets the requested coverage or the eligible list runs out. Keep every tied cell at the cutoff within a numerical tolerance of `10⁻¹²`. At 70% target coverage, cells with probabilities 50%, 25% and 25% all remain because the two 25% cells tie. If the 50% cell is clipped, its original 50% still contributes to the total. If a fixed condition excludes it, at most 50% is available. These totals refer to the original posterior. A geometric cut does not establish how probability is distributed inside a bin.

[The search](../src/study-search.ts) allocates up to 128 candidates per retained cell from a total budget of 12,000. It starts with seeded stratified candidates and refines in local batches near promising designs. Candidates are deduplicated within the cell. Surrogate responses determine constraint margins and feasibility. The reported Pareto front keeps feasible candidates that no other tested candidate matches or improves on every objective while strictly improving at least one. The search budget and surrogate fidelity limit what it can find. The cantilever workflow includes an analytic check for selected designs.
