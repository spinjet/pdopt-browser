# PDOPT-BN — browser application

A local-first Bayesian network workspace. Import CSV data, build a graph, train CPTs, and explore individual or **joint** posterior probabilities. Everything runs in your browser. The original Python/Streamlit application is maintained separately in [spinjet/bayesnet_tool](https://github.com/spinjet/bayesnet_tool).

Live application: [pdopt.a-spinelli.com](https://pdopt.a-spinelli.com).

This standalone repository was extracted from `web/` on the original repository’s `prototype/browser-bayesnet` branch at commit `01077b6ef7f85e5ca7f13ebb92a82a19fa2f2925`, preserving browser-specific history.

## Develop

Install Node.js 22.12+ (Node 24 LTS recommended) and npm. From the repository root:

```sh
git clone https://github.com/spinjet/pdopt-browser.git
cd pdopt-browser
npm ci
npm run dev
```

Open the address Vite prints. Hosted users need only a modern browser, not Node.js or Python. Use HTTPS outside localhost; direct `file://` opening is unsupported.

## Data and Probabilistic Exploration

1. In **Data**, import a UTF-8 CSV, sample a column to start a dataset, or load the cantilever example. Use **Sample column** and **Calculate column** to preview and apply new values. The table scrolls with pinned headers. Imported headers must be unique and nonblank. Delimiters, quoted fields and UTF-8 BOMs are supported.
2. Open **Probabilistic Exploration** and add columns as variables in **Network**, or add a manual categorical node with a uniform CPT. Connect nodes through graph handles or **Connections · keyboard controls**. Cyclic drafts can be saved, but cannot train or run inference.
3. Select a node and click **Edit states**. Numeric columns default to three equal-width bins between the observed minimum and maximum. Variable settings offers categorical, finite numeric and discretised representations, with manual, equal-width or quantile cuts.
4. Edit categorical **state display names**, keeping original source values visible. Click **Apply state names** to commit nonblank, unique aliases. This does not change encoding, evidence or CPTs.
5. Set **Decimal places** per numeric variable (0–12, default 2). Thresholds remain full precision; **Exact thresholds** shows stored cuts. Warnings identify indistinguishable rounded boundaries. Exact cuts enter the upper bin.
6. Choose **Learn from data** or **Force uniform CPT** for CSV-backed variables. A variable with a manual parent needs a uniform CPT because the CSV has no observations for that parent.
7. Review the retained counts and click **Train model**. The estimator and smoothing settings are under **Advanced training settings**. Dirichlet smoothing defaults to α=1 per child-state cell. Maximum likelihood requires observations for every learned row.

Uniform mode assigns equal probabilities in **every parent configuration**, retains edges and original observation counts, and leaves other variables trained from the original dataset. It does not rebalance data or guarantee uniform posteriors under evidence. CPT inspection explicitly identifies uniform overrides.

Empty fields are missing initially; strings such as `NA` remain categories unless explicitly configured. Learning excludes incomplete rows across selected variables. Bin fitting uses nonmissing observations in that source column when settings are applied; later row exclusion does not silently refit cuts. Variables need 2–64 states; exclude constant columns. Source data and fitted transformations are retained for reproducibility and later surrogate work.

## Cantilever beam example

In a new project, click **Load cantilever beam example**. Open **Help/Tutorial** for the sizing problem, equations, and a walkthrough. A seeded Latin hypercube produces 512 cases across width and depth (10–50 mm each), tip load (50–200 N), and material. The fourth sampling axis is split into equal thirds for steel, aluminium, and titanium. Each case uses one material. The span is fixed at 500 mm. [Latin hypercube sampling reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.LatinHypercube.html)

The dataset uses linear elastic beam theory with a fixed root and a point load at the free end. With section inertia I = bh³/12, it calculates root bending stress FL(h/2)/I and tip deflection FL³/(3EI). The **Failure** node marks a case as **Fails** when stress exceeds the material’s assumed tutorial allowable (45 MPa for steel, 35 MPa for aluminium, or 55 MPa for titanium). It marks other cases **Passes** for this bending stress check. [Penn State machine design notes](https://www.me.psu.edu/sommer/me360/n04_review.pdf)

The **Beam mass** node uses width, depth, and material, with volume bhL / 10⁹ in m³ and mass equal to density × volume. The **Design space** query compares materials and section ranges under a tip load of 87.50 to below 125.00 N, **Failure = Passes**, and **Beam mass < 1 kg**. View each material’s heatmap slice or compare the combinations in the joint table. The network groups the continuous inputs and mass into bins. Use the beam equations to check individual designs.

Open **States & training** and click **Train model**. The seeded sample covers every combination of the default parent bins, so the example uses maximum likelihood. Compare material slices with the 1 kg mass threshold, then raise the limit to 2 kg and rerun to see how the design space changes.

## Queries and Results

1. In **Queries**, choose the targets and evidence for each named query. Evidence can be a single state, an allowed-state set, or a numeric threshold. Numeric observations map through the saved cuts.
2. **Duplicate query** copies the selected targets and evidence for independent editing. The summary shows **P ( query variables | evidence )**. **Run selected query** evaluates one query and opens its result. **Run all queries** evaluates named queries concurrently and reports each status. Use the Results selector to revisit completed queries. **Edit query** returns to the query that produced it.
3. Switch between **Network graph** for individual probabilities at each node and **Query results** for diagrams and tables. One target shows prior and posterior bars. For joint queries, the heatmap shows two axes. Select a state for each additional target to view a slice. The scale stays fixed to the full distribution.
4. Hover, focus or tap a heatmap cell to see its probability. Use arrow keys to move between cells. **Show values** displays all cell values. The **Table** view supports sorting, pagination and state filtering for joint queries.

Joint probabilities are computed exactly through conditional inference, not multiplication of separate marginals. Limits are 4,096 combinations per group, 8,192 total, and 10 groups. These are output guards, not runtime guarantees. Cancellation and a 30-second watchdog preserve work; large queries may need fewer targets/states.

## Save, reopen and export

**Save project** downloads schema-version-5 JSON. Versions 1–4 migrate automatically, preserving learned probabilities, cuts, evidence and positions, and creating individual query views for their previous targets. Older queries use their saved evidence where available and otherwise inherit the previous shared evidence.

The project file includes the current CSV by default, including columns added in Data. To save without the CSV, turn off embedding in **Data settings**. **Locate project CSV** checks the file against the saved dataset hash before attaching it to a project. Saved CPTs remain queryable while the data is detached. Current query results also reopen without the CSV. Use **Save without cached results** to omit them.

Export the selected query as JSON. It retains target/state order, original source values and display labels, evidence, training provenance, fitted thresholds and full-precision probabilities. Keep project downloads as portable backups.

Use **Export table CSV** in the Table view to download the displayed columns and all rows matching the current filters. Probabilities are numeric fractions and the CSV can be loaded with pandas.

Use **Export figure** in the diagram for a vector SVG or a 300 or 600 dpi PNG. The preview uses the specified figure width. Heatmap exports include all cells in the selected slice and show a vertical probability scale. Choose a colour scheme, a query or custom caption, and which slice labels to show. Single-variable figures show prior and posterior bars.

Use **Export network image** beside the graph in **Network** or **Results → Network graph** to preview the layout and download SVG or PNG. The Results export includes node probabilities and highlights evidence and query targets with editable colours.

Open **Help/Tutorial** to keep the instructions beside the workspace while you work. **Help for this view** follows the active tab. Edit **About** in [doc/about.md](doc/about.md).

See the [documentation index](doc/README.md) for the maintainer manual and the help authoring guide.

## Checks and hosting

```sh
npm run typecheck
npm run test:unit
npm run test:numerical
npm run format:check
npm run build
# Separate terminal: serve the production build
npm run preview
# Then run Chromium browser tests
npm run test:e2e
```

The default test browser is `/usr/bin/chromium`; set `CHROMIUM_PATH` to another local executable. For Playwright-managed browsers, install with `npx playwright install chromium firefox webkit` and set `BROWSER=chromium`, `BROWSER=firefox` or `BROWSER=webkit`. Actual Safari requires a macOS check.

The optional reference generator runs from the repository root using a Python 3.11 environment with `pgmpy`, `numpy`, and `pandas` installed:

```sh
python tools/reference/generate.py
```

Python is not shipped or called by the web runtime. See [hosting](doc/hosting.md), [verification](doc/verification.md), and the [iteration decisions](doc/decisions/002-workspaces-joint-queries.md).

Development continues on `main` in this repository. Manual CPT editing, structure learning, offline installation, browser recovery and surrogate optimisation remain deferred.

## Events, graph images and sampling (0.3)

Expand **Multiple states / numeric threshold** in Query evidence to select several allowed states (OR within one variable, AND across variables). Numeric predicates support ≥, >, < and ≤. For discretised variables an exact cut is required; a threshold splitting a bin blocks inference. **Add exact cut & retrain** preserves the predicate, adds the boundary, and invalidates affected CPTs. Reattach the source CSV if necessary. Cuts enter the upper bin; > and ≤ use the next representable IEEE-754 number so equality is handled exactly, without snapping or fractional-bin assumptions. Finite numeric states compare their actual values directly.

Set-valued evidence is computed exactly through disposable deterministic indicator leaves inside the inference worker. These leaves never appear in the model, saved file or images. Unresolved predicates can be saved as drafts. Impossible evidence preserves previous results as outdated.

Each node has four connection handles. Drag from any side of a parent to any side of a child. Keyboard connection controls also select From/To sides. **Auto layout** uses the handle sides to choose the direction of the network. When the directions are mixed, it follows the dominant direction and keeps each edge attached to its original sides. Click an edge in **Network**, then use **Delete selected connection** or press Delete/Backspace to remove it. The Connections section also lists individual Remove buttons. Removing an edge invalidates affected CPTs and query results.

**Export network image** downloads Graphviz hierarchical SVG or PNG, optionally including current all-node probabilities. It exports the structure, independently of the canvas positions. **Layout direction → Auto** follows the predominant connection sides: bottom → top endpoints produce a top-down hierarchy, top → bottom produces bottom-up, and left/right connections produce a horizontal hierarchy. Dependencies determine the ranks. Mixed layouts use one overall direction (vertical wins ties), with explicit top-down, bottom-up, left-to-right and right-to-left overrides. Wider rank spacing and angled edge routing reduce looping paths while preserving the selected connection sides. Direction is an export setting and does not change saved positions or probabilities. Probability export requires current inference results. Graphviz runs locally in a cancellable worker; PNG rasterisation uses the browser canvas. Large PNGs are blocked with an SVG alternative.

Open **Sampling** to generate up to 5,000 interactive draws. Scatter plots, parallel coordinates and the sample table share one selection, which can be exported as CSV. **Download samples ZIP** saves samples.csv and manifest.json. Defaults: 1,000 rows, seed 42; maximum 100,000 rows and 100 MiB CSV. The deterministic mulberry32-v1 generator samples whole state combinations from the active query's full joint posterior; visual filters have no effect. Categorical values use display labels; finite numeric states use exact source numbers. Discretised numeric states draw uniformly within their bin intersected with finite editable bounds, defaulting to fitted min/max. This is an explicit within-bin assumption, not a learned continuous density. Bounds excluding any positive-probability state block export rather than changing the distribution. The manifest records ordering, labels, evidence, bounds, posterior, seed and training provenance.

Schema 5 keeps those settings and stores the explicit study constraints, predictor choices, estimators, and holdout settings. Legacy projects keep their CPTs and open outer bins. Missing connection sides default to right → left. Keep a backup before opening with a newer version. Graphviz/Expat source links and license texts ship under public/notices/graphviz. No backend, network upload, account or website publication is added.
