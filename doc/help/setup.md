## Optimisation Study · Setup

Start a study from a query result. Set design inputs, fixed operating conditions, objectives and constraints.

Posterior coverage is the sum of the original joint posterior masses of the retained cells. The study removes incompatible and zero-mass cells, ranks the eligible cells from highest to lowest probability, and keeps whole cells until it reaches the requested coverage. It also keeps ties at the cutoff. At 70% coverage, eligible cell masses of 50%, 25% and 25% retain all three because of the tie.

Clipping a cell to study bounds leaves its probability unchanged for coverage. A shortfall means the eligible cells together fall below the request. The search evaluates candidate feasibility separately.

Use **Design constraints** to add a numerical limit, accepted categories or a relationship such as `[Depth (mm)] >= 1.5 * [Width (mm)]`. Limits on the same variable all have to pass. The node inspector can edit these same definitions. A constraint on an otherwise unused variable can make that variable a required prediction.

For a response, choose **Direct from inputs** or **Use graph parents** independently of the estimator. Graph mode can predict an intermediate such as Root stress before using it to predict Failure. Highlighted links trace the configured predictors. Use the validation seed and optional design ID column to reproduce the holdout and keep repeated designs together.
