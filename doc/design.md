# Sampling, surrogates, and optimisation

[Documentation index](README.md)

## Joint posterior samples

Make a cumulative sum over the joint grid in target order. A seeded Mulberry32 generator draws a uniform number, and a binary search selects the first cumulative boundary above it. This preserves dependencies among queried states. Categorical draws use state display labels. Finite numeric draws use their corresponding values. Conditional on the chosen state combination, each discretised coordinate is uniform inside the intersection of its bin and finite sampling limits. An open internal upper endpoint is moved to the preceding representable number. Sampling rejects limits that exclude a positive-mass state instead of implicitly renormalising the distribution. With the same ordered query, seed, bounds, and posterior, draws are reproducible.

Interactive plots support up to 5,000 draws. The base ZIP supports up to 100,000 rows subject to its size limit. Charts, brushing and the table share row identities. With additional predictions, the exported manifest records sampled, fixed and predicted columns, the query, source hash, seed, bounds, and model validation. Predicted values are point estimates. Variation across rows tracks variation in the input designs and supplies no estimate of the forest’s residual uncertainty.

## Surrogate fitting

Both workspaces use [the same response model](../src/study-model.ts). Pick CSV-backed predictors and responses. Each categorical predictor is expanded into one binary indicator per source category. Numeric predictors use their original values in one feature. Missing, unknown and out-of-bound entries are dropped for the response and its selected predictors. Sampling predictors come from the drawn row or a user-supplied fixed value.

- Numeric responses use random forest regression. A finite numeric response is projected onto the nearest declared state, with the lower state used in a tie.
- Categorical responses use random forest classification. Class indices are converted to their original source categories before presentation.
- For a standalone Sampling fit, the seeded split (4921) takes about 20% of each applicable stratum for holdout and preserves singleton classes in training. A fit needs eight complete rows, four training rows, and a nonempty holdout. The seeded forest (491) uses a maximum of 768 training rows, with at least one row per class selected before the remaining training sample for classification. It uses 24 trees, sample bagging, all encoded features, maximum depth 12, and minimum node sample count 3. A constant training response uses a constant predictor.
- Accuracy is the share of correct held-out classes. Mean absolute error is `Σ|y − ŷ| / n`. Relative MAE divides by the range of observed holdout values when that range is positive. Study reports also count observed constraint violations a model missed. For a numeric threshold, the near-threshold band is 10% of the absolute threshold with a floor of machine epsilon.
- An in-memory fitted study model is eligible for reuse when the dataset hash, missing tokens, ordered predictors, response, and encodings match. Both paths use the same model settings. A fit for an unsupported response can fail while other responses succeed.

## Posterior coverage and search

A study starts from an immutable joint-query snapshot. Each joint cell represents a combination of target states. The study intersects the cell’s ranges with selected design limits, filters categorical choices, and checks exact fixed values. A cell is eligible when these intersections are nonempty and the cell has positive posterior probability.

Sort eligible cells by descending posterior mass. Take cells until the sum meets the requested coverage or the eligible list runs out. Keep every tied cell at the cutoff within a numerical tolerance of `10⁻¹²`. At 70% target coverage, cells with probabilities 50%, 25% and 25% all remain because the two 25% cells tie. If the 50% cell is clipped, its original 50% still contributes to the total. If a fixed condition excludes it, at most 50% is available. These totals refer to the original posterior. A geometric cut does not establish how probability is distributed inside a bin.

[The search](../src/study-search.ts) allocates up to 128 candidates per retained cell from a total budget of 12,000. It starts with seeded stratified candidates and refines in local batches near promising designs. Candidates are deduplicated within the cell. Surrogate responses determine constraint margins and feasibility. The reported Pareto front keeps feasible candidates that no other tested candidate matches or improves on every objective while strictly improving at least one. The search budget and surrogate fidelity limit what it can find. The cantilever workflow includes an analytic check for selected designs.

## Release 3 study settings

The Bayesian query and posterior still define where to search. **Design constraints** defines what each individual candidate must satisfy. Use the Setup table or the selected node’s inspector to edit the same saved definitions. Multiple limits on a variable combine with logical AND. Older inspector limits migrate into the table when the project opens, preserving strict operators and accepted categories or states.

- Numerical limits use the original candidate value and a signed margin. For an upper limit, the margin is limit minus value. For a lower limit, it is value minus limit. A zero margin only passes an inclusive comparison.
- Relationships use the [Data formula language](../src/formula.ts) and require a boolean result. For example, `[Depth (mm)] >= 1.5 * [Width (mm)]`. Invalid expressions are blocked in Setup. Missing values and candidate-dependent errors such as division by zero appear as **Unevaluable**.
- Input-only limits are evaluated before prediction. Later limits are evaluated after their dependencies have been computed. A known violation excludes the candidate and can skip later predictions. The design table identifies these skipped checks. Only designs with all constraints passed and all objectives evaluable enter the predicted Pareto front.

### Predictor structure and validation

**Direct from inputs** uses the saved selection of design inputs and operating conditions. **Use graph parents** includes each immediate parent and can include added design inputs. Intermediate variables with parents inherit the graph structure unless explicitly configured. The worker topologically sorts all dependencies and computes each predicted intermediate once per candidate. For the beam example, Width, Depth and Tip load produce Root stress. Failure receives predicted Root stress and Material.

The holdout partitions raw rows before any response-specific filtering. The default seed is 4921. Choose a design ID column to put all records of the same design in one partition. Downstream models fit on observed parent values in the training partition. At validation time, the chain receives recorded design inputs and operating conditions and uses its own predicted intermediates. The comparison fits a direct version with the same estimator choices and uses only rows evaluable by both for side-by-side scores.

**Run** reports MAE and maximum absolute error with units implied by the response label. It also reports both relative to the observed scored response range when that range is nonzero. Categorical responses show a confusion matrix. The end-to-end report compares predicted and recorded constraint decisions and shows both denominators, unevaluable rows and inspectable cases near limits. Changes to the study configuration invalidate the displayed results and require a refit.

### Estimator choices

Random forest is the default. The linear surface uses an intercept and standardized inputs. The quadratic surface adds squares and pairwise products. Both use a small ridge penalty for stable fitting. Gaussian process regression uses a standardized RBF covariance and returns a mean and standard deviation. Its interval is conditional on the supplied parent values. Use the [benchmark results](study-benchmark.md) and the current study’s held-out scores when choosing a model.
