import { expect, test } from "@playwright/test";
import { simulateReadableStream, stepCountIs, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import {
  createStreamUsageRecorder,
  MeteredModelError,
  type ModelUsageDetail,
  measureEmbeddingCall,
  normalizeModelUsage,
} from "../../src/lib/model-usage";
import {
  measureRuntimeModelCall,
  measureRuntimeRequest,
  type RuntimeRequestLog,
} from "../../src/lib/runtime-request-metrics";

test("streamed tool use counts every SDK step, including cached and reasoning tokens", async () => {
  const logs: unknown[] = [];
  let step = 0;
  const model = new MockLanguageModelV3({
    modelId: "fixture-model",
    doStream: async () => {
      const first = step++ === 0;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            ...(first
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: "lookup-1",
                    toolName: "lookup",
                    input: "{}",
                  },
                ]
              : [
                  { type: "text-start" as const, id: "text-1" },
                  {
                    type: "text-delta" as const,
                    id: "text-1",
                    delta: "fixture answer",
                  },
                  { type: "text-end" as const, id: "text-1" },
                ]),
            {
              type: "finish",
              finishReason: {
                unified: first ? "tool-calls" : "stop",
                raw: undefined,
              },
              usage: {
                inputTokens: {
                  total: first ? 20 : 30,
                  noCache: first ? 15 : 20,
                  cacheRead: first ? 5 : 10,
                  cacheWrite: 0,
                },
                outputTokens: {
                  total: first ? 4 : 6,
                  text: first ? 3 : 4,
                  reasoning: first ? 1 : 2,
                },
              },
            },
          ],
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
      };
    },
  });
  const result = streamText({
    model,
    prompt: "fixture question",
    tools: {
      lookup: tool({
        inputSchema: z.object({}),
        execute: async () => "fixture document",
      }),
    },
    stopWhen: stepCountIs(2),
    ...createStreamUsageRecorder(model.modelId, async (log) => {
      logs.push(log);
    }),
  });
  await result.consumeStream();
  await result.totalUsage;
  expect(model.doStreamCalls).toHaveLength(2);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    promptTokens: 50,
    completionTokens: 10,
    totalTokens: 60,
    statusCode: 200,
    usageDetails: [
      { usage: { cachedInputTokens: 5, reasoningTokens: 1 } },
      { usage: { cachedInputTokens: 10, reasoningTokens: 2 } },
    ],
  });
  expect(JSON.stringify(logs)).not.toContain("fixture answer");
  expect(JSON.stringify(logs)).not.toContain("fixture question");
});

test("stream failure preserves completed steps but leaves total usage unknown, without duplicate terminal logs", async () => {
  const logs: unknown[] = [];
  const callbacks = createStreamUsageRecorder("fixture", async (log) => {
    logs.push(log);
  });
  callbacks.onStepFinish({
    response: { modelId: "fixture" },
    usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
  });
  await callbacks.onError();
  await callbacks.onFinish();
  await callbacks.onAbort();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    statusCode: 500,
    totalTokens: null,
    usageDetails: [
      { status: "completed", usage: { totalTokens: 13 } },
      { status: "incomplete", usage: { totalTokens: null } },
    ],
  });
});

test("aborted and empty streams cannot report zero usage", async () => {
  const logs: unknown[] = [];
  await createStreamUsageRecorder("fixture", async (log) => {
    logs.push(log);
  }).onAbort();
  await createStreamUsageRecorder("fixture", async (log) => {
    logs.push(log);
  }).onFinish();
  expect(logs).toMatchObject([
    { statusCode: 499, totalTokens: null },
    { totalTokens: null },
  ]);
});

test("invalid provider token counts remain unknown", () => {
  expect(
    normalizeModelUsage({
      inputTokens: -1,
      outputTokens: Number.NaN,
      totalTokens: Infinity,
    }),
  ).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null });
  expect(
    normalizeModelUsage({ inputTokens: 10, outputTokens: 4 }),
  ).toMatchObject({ totalTokens: 14, cachedInputTokens: null });
});

test("embedding batches preserve usage and failures without recording source text", async () => {
  const logs: ModelUsageDetail[] = [];
  const record = async (detail: ModelUsageDetail) => {
    logs.push(detail);
  };
  const result = await measureEmbeddingCall(
    "embedding-fixture",
    "embedding_ingest",
    async () => ({ embeddings: [[1]], usage: { tokens: 42 } }),
    record,
  );
  expect(result.embeddings).toEqual([[1]]);
  const failure = new Error("provider unavailable");
  await expect(
    measureEmbeddingCall(
      "embedding-fixture",
      "embedding_query",
      async () => {
        throw failure;
      },
      record,
    ),
  ).rejects.toBe(failure);
  expect(logs).toMatchObject([
    {
      purpose: "embedding_ingest",
      status: "completed",
      usage: { inputTokens: 42, outputTokens: 0, totalTokens: 42 },
    },
    {
      purpose: "embedding_query",
      status: "failed",
      usage: { totalTokens: null },
    },
  ]);
  await expect(
    measureEmbeddingCall(
      "embedding-fixture",
      "embedding_query",
      async () => ({ usage: { tokens: 2 } }),
      async () => {
        throw new Error("log unavailable");
      },
    ),
  ).resolves.toEqual({ usage: { tokens: 2 } });
});

test("provider-reported usage survives invalid structured output and fallback model attempts", async () => {
  const logs: RuntimeRequestLog[] = [];
  await measureRuntimeRequest(
    "structured_turn",
    async (metrics) => {
      metrics.projectId = 17;
      try {
        await measureRuntimeModelCall(
          17,
          async () => {
            throw new MeteredModelError(
              { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
              new Error("invalid output"),
            );
          },
          "primary",
        );
      } catch {
        /* The runtime repairs the output using a fallback. */
      }
      await measureRuntimeModelCall(
        17,
        async () => ({
          usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
        }),
        "fallback",
      );
      return new Response();
    },
    (log) => {
      logs.push(log);
    },
  );
  expect(logs[0]).toMatchObject({
    totalTokens: 38,
    usageDetails: [
      { modelId: "primary", status: "failed", usage: { totalTokens: 13 } },
      { modelId: "fallback", status: "completed", usage: { totalTokens: 25 } },
    ],
  });
});

test("late model completion cannot mutate an already recorded request", async () => {
  let complete!: (value: {
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }) => void;
  const pending = new Promise<{
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>((resolve) => {
    complete = resolve;
  });
  const logs: RuntimeRequestLog[] = [];
  let call!: Promise<unknown>;
  await measureRuntimeRequest(
    "project_runtime",
    async (metrics) => {
      metrics.projectId = 17;
      call = measureRuntimeModelCall(17, () => pending, "fixture");
      return new Response();
    },
    (log) => {
      logs.push(log);
    },
  );
  const snapshot = JSON.stringify(logs);
  complete({ usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  await call;
  expect(JSON.stringify(logs)).toBe(snapshot);
  expect(logs[0].usageDetails[0].status).toBe("incomplete");
  expect(logs[0].totalTokens).toBeNull();
});
