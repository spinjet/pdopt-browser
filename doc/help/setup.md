## Optimisation Study · Setup

Start a study from a query result. Set design inputs, fixed operating conditions, objectives and constraints.

Posterior coverage is the sum of the original joint posterior masses of the retained cells. The study removes incompatible and zero-mass cells, ranks the eligible cells from highest to lowest probability, and keeps whole cells until it reaches the requested coverage. It also keeps ties at the cutoff. At 70% coverage, eligible cell masses of 50%, 25% and 25% retain all three because of the tie.

Clipping a cell to study bounds leaves its probability unchanged for coverage. A shortfall means the eligible cells together fall below the request. The search evaluates candidate feasibility separately.
