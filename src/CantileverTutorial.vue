<script setup lang="ts">
import { ref } from "vue";
import { materials, sampleCount, spanMm } from "./cantilever-example";
import beamDiagram from "./cantilever-beam.svg";

const tutorial = ref<HTMLDialogElement>();
</script>

<template>
  <button aria-haspopup="dialog" @click="tutorial?.showModal()">
    Cantilever tutorial
  </button>
  <Teleport to="body">
    <dialog
      ref="tutorial"
      class="workspace-dialog cantilever-tutorial"
      aria-labelledby="cantilever-tutorial-title"
    >
      <header class="workspace-dialog-heading">
        <h2 id="cantilever-tutorial-title">Cantilever beam tutorial</h2>
        <button autofocus @click="tutorial?.close()">Close tutorial</button>
      </header>
      <div
        class="tutorial-content"
        role="region"
        aria-label="Tutorial steps"
        tabindex="0"
      >
        <h3>The sizing problem</h3>
        <p>
          This example represents the design of a cantilever beam with a
          rectangular section. The dataset is computed in advance with a
          physical simulation model. The Bayesian Network represents the
          cause-effect connection between the variables.
        </p>
        <p>
          Choose a rectangular section and material for a {{ spanMm }} mm beam
          fixed at one end. A downward point load acts at the free end. The
          example checks the bending stress at the fixed end and estimates how
          far the free end moves. It also estimates the beam’s own mass.
        </p>
        <figure class="tutorial-figure">
          <img
            :src="beamDiagram"
            alt="Cantilever schematic showing the fixed left end, a downward tip load F at the free right end, span L, and a rectangular cross-section of width b and vertical depth h."
            width="680"
            height="210"
          />
          <figcaption>
            Side view and cross-section. The beam span is {{ spanMm }} mm and
            the section depth <var>h</var> is measured vertically.
          </figcaption>
        </figure>
        <p>
          The simulation uses {{ sampleCount }} Latin hypercube samples. Width
          and depth each range from 10 to 50 mm, and tip load ranges from 50 to
          200 N. Each input range is split into equal intervals. The sampler
          uses each interval once per input and shuffles how the inputs are
          paired. Material is the fourth sampled input. It assigns one of three
          materials to each case in nearly equal proportions, giving
          {{ sampleCount }} rows total. The material properties below are
          tutorial assumptions.
        </p>
        <table class="tutorial-materials">
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Young’s modulus (GPa)</th>
              <th scope="col">Density (kg/m³)</th>
              <th scope="col">Allowable bending stress (MPa)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in materials" :key="m.name">
              <th scope="row">{{ m.name }}</th>
              <td>{{ m.modulusMpa / 1000 }}</td>
              <td>{{ m.densityKgM3.toLocaleString() }}</td>
              <td>{{ m.allowableMpa }}</td>
            </tr>
          </tbody>
        </table>
        <h3>Calculations</h3>
        <p>
          For width <var>b</var>, depth <var>h</var>, span <var>L</var>, and tip
          load <var>F</var>, the section inertia is <var>I</var> = <var>b</var
          ><var>h</var>³ / 12.
        </p>
        <ul>
          <li>
            Root stress <var>σ</var> = <var>FL</var>(<var>h</var> / 2) /
            <var>I</var>. The beam fails if this exceeds the material’s
            allowable stress.
          </li>
          <li>
            Tip deflection <var>δ</var> = <var>F</var><var>L</var>³ / (3<var
              >E</var
            ><var>I</var>), using linear elastic bending and the applied tip
            load.
          </li>
          <li>
            Beam mass <var>m</var> = <var>ρ</var><var>V</var>, where
            <var>V</var> = <var>b</var><var>h</var><var>L</var> / 10⁹ converts
            mm³ to m³. For example, a 20 × 20 mm aluminium section has a mass of
            0.54 kg.
          </li>
        </ul>
        <h3>Calculate two columns</h3>
        <p>
          Open <strong>Data</strong> and choose
          <strong>Calculate column</strong>. Try these formulas:
        </p>
        <ul>
          <li>
            <strong>Section area (mm²)</strong>
            <code>=[Width (mm)] * [Depth (mm)]</code>
          </li>
          <li>
            <strong>Passes under 1 kg</strong>
            <code>=AND([Failure] = "Passes", [Beam mass (kg)] &lt; 1)</code>
          </li>
        </ul>
        <p>
          The flag is 1 when both requirements hold and 0 when either fails. An
          unavailable measurement produces a blank result. Preview the columns
          before applying them.
        </p>
        <h3>Find a feasible design space</h3>
        <ol>
          <li>
            Load the example in <strong>Data</strong>, then click
            <strong>Train model</strong> in
            <strong>States &amp; training</strong>.
          </li>
          <li>
            In <strong>Queries</strong>, select <strong>Design space</strong>.
            Select the <strong>87.50 to below 125.00 N</strong> state for
            <strong>Tip load (N)</strong>, and set <strong>Failure</strong> to
            <strong>Passes</strong>. Leave width, depth, and material unobserved
            so the query can compare them.
          </li>
          <li>
            Under <strong>Beam mass (kg)</strong>, expand
            <strong>Multiple states / numeric threshold</strong>. Choose
            <strong>&lt; (below)</strong>, enter <strong>1</strong>, and click
            <strong>Apply threshold</strong>. Click
            <strong>Save evidence with query</strong> to keep these conditions.
            The example already has this preset, so you can also use
            <strong>Apply saved evidence</strong> to set them in one step.
            Review <strong>P ( query variables | evidence )</strong> and run the
            query.
          </li>
          <li>
            In the heatmap, choose a <strong>Material</strong> to see its width
            and depth grid. Turn on <strong>Show values</strong>. Cells with
            nonzero probability identify promising ranges to investigate. Check
            aluminium and titanium, then see what happens for steel. Use
            <strong>Table</strong> to compare all combinations together.
          </li>
          <li>
            Click <strong>Edit query</strong> and raise the mass limit to
            <strong>2 kg</strong>. Rerun and see which steel ranges gain
            probability. Use <strong>Apply saved evidence</strong> to return to
            the 1 kg setup. To keep your preset when you reopen the file, click
            <strong>Save project</strong>.
          </li>
        </ol>
        <h3>Optimise the retained regions</h3>
        <p>
          Restore the saved 1 kg evidence and rerun
          <strong>Design space</strong>. Choose
          <strong>Start study from this query</strong>, review the retained
          cells, and set the exact tip load in Setup. Fit the surrogates and
          search the regions. In Explore, switch to <strong>Verified</strong> to
          compare designs evaluated with the beam equations. Select part of the
          Pareto front and open <strong>Parallel coordinates</strong> to inspect
          its dimensions and materials.
        </p>
        <p>
          The Bayesian network groups continuous values into ranges. A cell can
          contain a mix of passing and failing designs. Check exact dimensions
          with the beam equations before choosing a design. The mass bins
          include the 1 and 2 kg limits used here.
        </p>
      </div>
    </dialog>
  </Teleport>
</template>
