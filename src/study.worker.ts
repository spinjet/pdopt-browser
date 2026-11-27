import {
  studySchema,
  migrateStudyConstraints,
  datasetSchema,
  validateProject,
  resolveEvidence,
  variableSchema,
  studyValueSchema,
} from "./domain";
import { infer } from "./engine";
import {
  checkStudy,
  diagnosticProbabilities,
  selectRegions,
  studyObservedCounts,
} from "./study";
import {
  fitResponse,
  fitStudyWithValidation,
  surrogateFitKey,
  type ResponseModel,
} from "./study-model";
import { searchStudy } from "./study-search";

import { z } from "zod";
import { MAX_VISUAL_SAMPLES } from "./sampling";

const samplingFit = z.object({
  key: z.string(),
  datasetHash: z.string(),
  dataset: datasetSchema.optional(),
  missingTokens: z.array(z.string()),
  predictors: z.array(variableSchema).min(1).max(100),
  outputs: z.array(variableSchema).min(1).max(100),
});
let sampleModels: { key: string; models: ResponseModel[] } | undefined;
let fitted: { key: string; models: ResponseModel[] } | undefined;
self.onmessage = async ({ data }) => {
  const { id, op, payload } = data;
  const progress = (update: unknown) =>
    self.postMessage({ id, progress: update });
  try {
    if (op === "sampling-fit") {
      const fit = samplingFit.parse(payload);
      if (fit.dataset && fit.dataset.hash !== fit.datasetHash)
        throw new Error("Reattach the matching project dataset.");
      const models: ResponseModel[] = [];
      const reports = fit.outputs.map((output) => {
        try {
          const key = surrogateFitKey(
            output,
            fit.predictors,
            fit.missingTokens,
            fit.datasetHash,
          );
          const cached = fitted?.models.find((model) => model.fitKey === key);
          if (!cached && !fit.dataset)
            throw new Error("Attach the CSV to fit this output.");
          const model =
            cached ??
            fitResponse(
              fit.dataset!,
              output,
              fit.predictors,
              fit.missingTokens,
            );
          models.push(model);
          return {
            id: output.id,
            reused: !!cached,
            validation: model.validation,
          };
        } catch (error) {
          return { id: output.id, error: (error as Error).message };
        }
      });
      sampleModels = { key: fit.key, models };
      self.postMessage({ id, result: reports });
      return;
    }
    if (op === "sampling-predict") {
      const input = z
        .object({
          key: z.string(),
          rows: z
            .array(z.record(z.string(), studyValueSchema))
            .max(MAX_VISUAL_SAMPLES),
        })
        .parse(payload);
      if (!sampleModels || sampleModels.key !== input.key)
        throw new Error("Fit surrogates for this sample before predicting.");
      const result = Object.fromEntries(
        sampleModels.models.map((model) => [
          model.variable.id,
          model.predict(input.rows),
        ]),
      );
      self.postMessage({ id, result });
      return;
    }
    const study = migrateStudyConstraints(studySchema.parse(payload.study));
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
      const { models, report } = fitStudyWithValidation(
        study,
        dataset,
        (current, total) => progress({ current, total }),
      );
      fitted = { key: payload.key, models };
      result = report;
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
