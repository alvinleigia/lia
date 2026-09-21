import { expect, test } from "@playwright/test";
import {
  measureRuntimeModelCall,
  measureRuntimeRequest,
  type RuntimeRequestLog,
} from "../../src/lib/runtime-request-metrics";

const usage = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };

test("deterministic requests record latency, outcome and zero model usage", async () => {
  const logs: RuntimeRequestLog[] = [];
  const response = await measureRuntimeRequest(
    "project_runtime",
    async (metrics) => {
      metrics.projectId = 17;
      return new Response("private reply", { status: 409 });
    },
    (log) => logs.push(log),
  );
  expect(response.status).toBe(409);
  expect(logs).toEqual([
    {
      route: "project_runtime",
      projectId: 17,
      statusCode: 409,
      latencyMs: expect.any(Number),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  ]);
  expect(JSON.stringify(logs)).not.toContain("private reply");
});

test("unresolved access is not attributed to a claimed project", async () => {
  const logs: RuntimeRequestLog[] = [];
  await measureRuntimeRequest(
    "widget_runtime",
    async () => new Response(null, { status: 403 }),
    (log) => logs.push(log),
  );
  expect(logs[0]).toMatchObject({ projectId: null, statusCode: 403 });
});

test("concurrent requests isolate usage and ignore calls for another project", async () => {
  const logs: RuntimeRequestLog[] = [];
  await Promise.all(
    [17, 18].map((projectId) =>
      measureRuntimeRequest(
        "widget_runtime",
        async (metrics) => {
          metrics.projectId = projectId;
          await Promise.all([
            measureRuntimeModelCall(projectId, async () => ({ usage })),
            measureRuntimeModelCall(projectId, async () => ({ usage })),
            measureRuntimeModelCall(99, async () => ({
              usage: { inputTokens: 900, outputTokens: 900, totalTokens: 1800 },
            })),
          ]);
          return new Response();
        },
        (log) => logs.push(log),
      ),
    ),
  );
  expect(logs).toHaveLength(2);
  for (const log of logs)
    expect(log).toMatchObject({
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
    });
  expect(logs.map((log) => log.projectId).sort()).toEqual([17, 18]);
});

test("failed model calls leave usage unknown and propagate the original error", async () => {
  const logs: RuntimeRequestLog[] = [];
  const failure = new Error("provider unavailable");
  await expect(
    measureRuntimeRequest(
      "project_runtime",
      async (metrics) => {
        metrics.projectId = 17;
        await measureRuntimeModelCall(17, async () => {
          throw failure;
        });
        return new Response();
      },
      (log) => logs.push(log),
    ),
  ).rejects.toBe(failure);
  expect(logs[0]).toMatchObject({
    statusCode: 500,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  });
});

test("unreported token counts remain unknown across subsequent successful calls", async () => {
  const logs: RuntimeRequestLog[] = [];
  await measureRuntimeRequest(
    "project_runtime",
    async (metrics) => {
      metrics.projectId = 17;
      await measureRuntimeModelCall(17, async () => ({
        usage: { ...usage, totalTokens: null },
      }));
      await measureRuntimeModelCall(17, async () => ({ usage }));
      return new Response();
    },
    (log) => logs.push(log),
  );
  expect(logs[0]).toMatchObject({
    promptTokens: 20,
    completionTokens: 8,
    totalTokens: null,
  });
});

test("metrics scheduling failure cannot fail a successful request", async () => {
  const response = await measureRuntimeRequest(
    "project_runtime",
    async () => new Response("ok"),
    () => {
      throw new Error("logger failed");
    },
  );
  expect(await response.text()).toBe("ok");
});
