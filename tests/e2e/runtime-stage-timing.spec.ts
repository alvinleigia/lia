import { expect, test } from "@playwright/test";
import {
  formatRuntimeServerTiming,
  measureRuntimeStage,
  type RuntimeStageTiming,
} from "../../src/lib/runtime-stage-timing";

test("runtime stages are measured and formatted for Server-Timing", async () => {
  const timings: RuntimeStageTiming[] = [];

  const result = await measureRuntimeStage(
    "hybrid task/start",
    (timing) => timings.push(timing),
    async () => "done",
  );

  expect(result).toBe("done");
  expect(timings).toHaveLength(1);
  expect(timings[0]?.stage).toBe("hybrid task/start");
  expect(timings[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(formatRuntimeServerTiming(timings)).toMatch(
    /^hybrid_task_start;dur=\d+\.\d$/,
  );
});

test("runtime stages are recorded when an operation fails", async () => {
  const timings: RuntimeStageTiming[] = [];

  await expect(
    measureRuntimeStage(
      "failed_stage",
      (timing) => timings.push(timing),
      async () => {
        throw new Error("expected failure");
      },
    ),
  ).rejects.toThrow("expected failure");

  expect(timings).toHaveLength(1);
  expect(formatRuntimeServerTiming(timings)).toMatch(
    /^failed_stage;dur=\d+\.\d$/,
  );
});
