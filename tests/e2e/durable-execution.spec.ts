import { expect, test } from "@playwright/test";
import { getDurableRetryDelayMs } from "../../src/lib/durable-jobs";
import {
  normalizeTraceId,
  resolveTraceId,
} from "../../src/lib/execution-trace";

test.describe("durable execution contracts", () => {
  test("uses deterministic capped exponential retry delays", () => {
    const first = getDurableRetryDelayMs({
      attempt: 1,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });
    const second = getDurableRetryDelayMs({
      attempt: 2,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });
    const capped = getDurableRetryDelayMs({
      attempt: 20,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });

    expect(first).toBeGreaterThanOrEqual(800);
    expect(first).toBeLessThanOrEqual(1_200);
    expect(second).toBeGreaterThanOrEqual(1_600);
    expect(second).toBeLessThanOrEqual(2_400);
    expect(capped).toBeGreaterThanOrEqual(6_400);
    expect(capped).toBeLessThanOrEqual(9_600);
    expect(
      getDurableRetryDelayMs({
        attempt: 2,
        baseDelayMs: 1_000,
        jitterKey: "project:1:job:one",
        maxDelayMs: 8_000,
      }),
    ).toBe(second);
  });

  test("accepts safe incoming trace ids and replaces invalid values", () => {
    expect(normalizeTraceId("trace:project-194.request_1")).toBe(
      "trace:project-194.request_1",
    );
    expect(normalizeTraceId("short")).toBeNull();
    expect(normalizeTraceId("trace id with spaces")).toBeNull();
    expect(resolveTraceId("trace:project-194.request_1")).toBe(
      "trace:project-194.request_1",
    );
    expect(resolveTraceId("bad")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
