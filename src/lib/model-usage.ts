// Provider-reported usage only. Unknown usage must never become a zero-cost call.
export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
};

export type ModelUsageDetail = {
  modelId: string;
  stage?: string;
  durationMs?: number;
  purpose: "structured_turn" | "chat" | "embedding_query" | "embedding_ingest";
  status: "completed" | "failed" | "incomplete";
  usage: ModelUsage;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function normalizeModelUsage(value: unknown): ModelUsage {
  const usage = value as
    | {
        inputTokens?: unknown;
        outputTokens?: unknown;
        totalTokens?: unknown;
        inputTokenDetails?: { cacheReadTokens?: unknown };
        outputTokenDetails?: { reasoningTokens?: unknown };
      }
    | null
    | undefined;
  const inputTokens = count(usage?.inputTokens);
  const outputTokens = count(usage?.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      count(usage?.totalTokens) ??
      (inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null),
    cachedInputTokens: count(usage?.inputTokenDetails?.cacheReadTokens),
    reasoningTokens: count(usage?.outputTokenDetails?.reasoningTokens),
  };
}

export function sumModelUsage(usages: readonly ModelUsage[]): ModelUsage {
  const sum = (key: keyof ModelUsage) => {
    let total = 0;
    for (const usage of usages) {
      const value = count(usage[key]);
      if (value === null) return null;
      total += value;
    }
    return total;
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
  };
}

export class MeteredModelError extends Error {
  constructor(
    public readonly usage: ModelUsage,
    cause: unknown,
  ) {
    super("Model output could not be processed.", { cause });
  }
}

export function failedModelUsage(error: unknown): ModelUsage {
  return error instanceof MeteredModelError
    ? error.usage
    : normalizeModelUsage(null);
}

export function tokenLogFields(usage: ModelUsage) {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

type StreamStep = { usage: unknown; response: { modelId: string } };

// One terminal log per stream, including failures before the first completed step.
export function createStreamUsageRecorder(
  modelId: string,
  record: (
    log: ReturnType<typeof tokenLogFields> & {
      statusCode: number;
      usageDetails: ModelUsageDetail[];
    },
  ) => Promise<void>,
) {
  const details: ModelUsageDetail[] = [];
  let recorded = false;
  const finish = async (incomplete: boolean, statusCode: number) => {
    if (recorded) return;
    recorded = true;
    if (incomplete || details.length === 0) {
      details.push({
        modelId,
        purpose: "chat",
        status: "incomplete",
        usage: normalizeModelUsage(null),
      });
    }
    await record({
      statusCode,
      usageDetails: details.slice(),
      ...tokenLogFields(sumModelUsage(details.map((detail) => detail.usage))),
    });
  };
  return {
    onStepFinish: (step: StreamStep) => {
      if (!recorded)
        details.push({
          modelId: step.response.modelId || modelId,
          purpose: "chat",
          status: "completed",
          usage: normalizeModelUsage(step.usage),
        });
    },
    onFinish: () => finish(false, 200),
    onError: () => finish(true, 500),
    onAbort: () => finish(true, 499),
  };
}

export async function measureEmbeddingCall<
  T extends { usage: { tokens: number } },
>(
  modelId: string,
  purpose: "embedding_query" | "embedding_ingest",
  generate: () => Promise<T>,
  record: (detail: ModelUsageDetail) => Promise<void>,
): Promise<T> {
  let detail: ModelUsageDetail = {
    modelId,
    purpose,
    status: "failed",
    usage: normalizeModelUsage(null),
  };
  try {
    const result = await generate();
    const tokens = count(result.usage.tokens);
    detail = {
      modelId,
      purpose,
      status: "completed",
      usage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
    };
    return result;
  } finally {
    try {
      await record(detail);
    } catch {
      /* Metering must not change the operation outcome. */
    }
  }
}
