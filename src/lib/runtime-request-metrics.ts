import { AsyncLocalStorage } from "node:async_hooks";

type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type RequestMetrics = {
  projectId: number | null;
  calls: number;
  completedCalls: number;
  usage: Usage;
};

export type RuntimeRequestLog = {
  route: "project_runtime" | "widget_runtime";
  projectId: number | null;
  statusCode: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

const requests = new AsyncLocalStorage<RequestMetrics>();

export async function measureRuntimeModelCall<T extends { usage: Usage }>(
  projectId: number,
  generate: () => Promise<T>,
): Promise<T> {
  const metrics = requests.getStore();
  if (!metrics || metrics.projectId !== projectId) return generate();
  metrics.calls += 1;
  const result = await generate();
  metrics.completedCalls += 1;
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    const value = result.usage[key];
    const previous = metrics.usage[key];
    metrics.usage[key] =
      previous !== null &&
      value !== null &&
      Number.isFinite(value) &&
      value >= 0
        ? previous + value
        : null;
  }
  return result;
}

export async function measureRuntimeRequest(
  route: RuntimeRequestLog["route"],
  handle: (metrics: { projectId: number | null }) => Promise<Response>,
  record: (log: RuntimeRequestLog) => void,
): Promise<Response> {
  const startedAt = performance.now();
  const metrics: RequestMetrics = {
    projectId: null,
    calls: 0,
    completedCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
  let statusCode = 500;
  return requests.run(metrics, async () => {
    try {
      const response = await handle(metrics);
      statusCode = response.status;
      return response;
    } finally {
      const complete = metrics.calls === metrics.completedCalls;
      try {
        record({
          route,
          projectId: metrics.projectId,
          statusCode,
          latencyMs: Math.round(performance.now() - startedAt),
          promptTokens: complete ? metrics.usage.inputTokens : null,
          completionTokens: complete ? metrics.usage.outputTokens : null,
          totalTokens: complete ? metrics.usage.totalTokens : null,
        });
      } catch {
        console.error("Failed to schedule runtime request metrics.");
      }
    }
  });
}
