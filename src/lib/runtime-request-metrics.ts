import { AsyncLocalStorage } from "node:async_hooks";
import {
  failedModelUsage,
  type ModelUsage,
  type ModelUsageDetail,
  normalizeModelUsage,
  sumModelUsage,
  tokenLogFields,
} from "@/lib/model-usage";

type RequestMetrics = {
  projectId: number | null;
  errorCode?: string | null;
  details: ModelUsageDetail[];
};

export type RuntimeRequestLog = {
  route: "project_runtime" | "widget_runtime" | "structured_turn";
  projectId: number | null;
  statusCode: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  usageDetails: ModelUsageDetail[];
  errorCode?: string | null;
};

const requests = new AsyncLocalStorage<RequestMetrics>();

export async function measureRuntimeModelCall<T extends { usage: ModelUsage }>(
  projectId: number,
  generate: () => Promise<T>,
  modelId = "unknown",
): Promise<T> {
  const metrics = requests.getStore();
  if (!metrics || metrics.projectId !== projectId) return generate();
  const detail: ModelUsageDetail = {
    modelId,
    purpose: "structured_turn",
    status: "incomplete",
    usage: normalizeModelUsage(null),
  };
  metrics.details.push(detail);
  try {
    const result = await generate();
    detail.status = "completed";
    detail.usage = result.usage;
    return result;
  } catch (error) {
    detail.status = "failed";
    detail.usage = failedModelUsage(error);
    throw error;
  }
}

export async function measureRuntimeRequest(
  route: RuntimeRequestLog["route"],
  handle: (metrics: {
    projectId: number | null;
    errorCode?: string | null;
  }) => Promise<Response>,
  record: (log: RuntimeRequestLog) => void,
): Promise<Response> {
  const startedAt = performance.now();
  const metrics: RequestMetrics = {
    projectId: null,
    details: [],
  };
  let statusCode = 500;
  return requests.run(metrics, async () => {
    try {
      const response = await handle(metrics);
      statusCode = response.status;
      return response;
    } finally {
      // Snapshot before scheduling: timed-out providers may finish later.
      const usageDetails = metrics.details.map((detail) => ({
        ...detail,
        usage: { ...detail.usage },
      }));
      try {
        record({
          route,
          projectId: metrics.projectId,
          statusCode,
          latencyMs: Math.round(performance.now() - startedAt),
          ...tokenLogFields(
            sumModelUsage(usageDetails.map((detail) => detail.usage)),
          ),
          usageDetails,
          ...(metrics.errorCode !== undefined
            ? { errorCode: metrics.errorCode }
            : {}),
        });
      } catch {
        console.error("Failed to schedule runtime request metrics.");
      }
    }
  });
}
