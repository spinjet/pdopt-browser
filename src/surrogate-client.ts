import { ComputeClient } from "./client";

// Both workspaces use the same worker so compatible fitted study models can be reused.
export const surrogateClient = new ComputeClient(
  () =>
    new Worker(new URL("./study.worker.ts", import.meta.url), {
      type: "module",
    }),
);
