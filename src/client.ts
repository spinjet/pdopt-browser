import { z } from "zod";
import { ModelError } from "./engine";
const responseSchema = z.object({
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  progress: z.unknown().optional(),
});
export class ComputeClient {
  private worker: Worker | undefined;
  private nextId = 0;
  private pending:
    | {
        id: number;
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        onProgress?: (update: unknown) => void;
      }
    | undefined;
  constructor(
    private factory = () =>
      new Worker(new URL("./compute.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  private start() {
    if (this.worker) return;
    this.worker = this.factory();
    this.worker.onmessage = ({ data }) => {
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) {
        this.cancel("ENGINE_FAILURE", "Invalid worker response.");
        return;
      }
      const r = parsed.data;
      if (this.pending?.id !== r.id) return;
      const pending = this.pending;
      if (r.progress !== undefined) {
        pending.onProgress?.(r.progress);
        return;
      }
      this.pending = undefined;
      clearTimeout(pending.timer);
      if (
        r.error &&
        ["ENGINE_INIT_FAILED", "ENGINE_FAILURE"].includes(r.code || "")
      ) {
        this.worker?.terminate();
        this.worker = undefined;
      }
      if (r.error)
        pending.reject(new ModelError(r.code || "ENGINE_FAILURE", r.error));
      else pending.resolve(r.result);
    };
    this.worker.onerror = () =>
      this.cancel(
        "ENGINE_FAILURE",
        "Computation worker failed. Retry the operation.",
      );
  }
  request(
    op: string,
    payload: unknown,
    options: { timeout?: number; onProgress?: (update: unknown) => void } = {},
  ): Promise<unknown> {
    if (this.pending)
      return Promise.reject(
        new Error("A computation is already running. Cancel it first."),
      );
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.cancel(
            "RESOURCE_LIMIT",
            "Computation took too long. Reduce the workload or retry.",
          ),
        options.timeout ?? 30000,
      );
      this.pending = {
        id,
        resolve,
        reject,
        timer,
        onProgress: options.onProgress,
      };
      try {
        this.worker!.postMessage({ id, op, payload });
      } catch (e) {
        this.cancel("ENGINE_FAILURE", String(e));
      }
    });
  }
  cancel(
    code = "CANCELLED",
    message = "Calculation cancelled. Your project is preserved.",
  ) {
    this.worker?.terminate();
    this.worker = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new ModelError(code, message));
      this.pending = undefined;
    }
  }
}
