import {
  studySchema,
  datasetSchema,
  validateProject,
  resolveEvidence,
} from "./domain";
import { infer } from "./engine";
import {
  checkStudy,
  diagnosticProbabilities,
  selectRegions,
  studyObservedCounts,
} from "./study";
import { fitStudy, type ResponseModel } from "./study-model";
import { searchStudy } from "./study-search";

let fitted: { key: string; models: ResponseModel[] } | undefined;
self.onmessage = async ({ data }) => {
  const { id, op, payload } = data;
  const progress = (update: unknown) =>
    self.postMessage({ id, progress: update });
  try {
    const study = studySchema.parse(payload.study);
    let result: unknown;
    if (op === "counts") {
      const dataset = datasetSchema.parse(payload.dataset);
      if (study.sourceHash !== dataset.hash)
        throw new Error("Attach the study dataset first.");
      result = studyObservedCounts(study, dataset);
    } else if (op === "diagnostic") {
      const url = new URL(payload.engineUrl);
      if (url.origin !== self.location.origin)
        throw new Error("The inference engine must load locally.");
      const { createInProcessBN } = (await import(
        /* @vite-ignore */ url.href
      )) as typeof import("jsagrum");
      result = await diagnosticProbabilities(study, async (snapshot) => {
        const project = validateProject(snapshot);
        return await infer(
          project,
          resolveEvidence(project),
          [],
          createInProcessBN,
          project.queryGroups,
        );
      });
    } else if (op === "fit") {
      fitted = undefined;
      const dataset = datasetSchema.parse(payload.dataset);
      checkStudy(study, dataset);
      const models = fitStudy(study, dataset, (current, total) =>
        progress({ current, total }),
      );
      fitted = { key: payload.key, models };
      result = models.map((model) => model.validation);
    } else if (op === "search") {
      if (!fitted || fitted.key !== payload.key)
        throw new Error("Fit the surrogates for the current setup first.");
      const { retained } = selectRegions(study);
      if (!retained.length)
        throw new Error("There are no eligible design regions.");
      result = searchStudy(study, retained, fitted.models, progress);
    } else throw new Error("Unknown study operation.");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: (error as Error).message,
      code: "STUDY_ERROR",
    });
  }
};
