export type RuntimeStageTiming = {
  durationMs: number;
  stage: string;
};

export type RuntimeTimingRecorder = (timing: RuntimeStageTiming) => void;

export function recordRuntimeStage(
  stage: string,
  startedAt: number,
  recordTiming: RuntimeTimingRecorder | undefined,
) {
  recordTiming?.({
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    stage,
  });
}

export async function measureRuntimeStage<T>(
  stage: string,
  recordTiming: RuntimeTimingRecorder | undefined,
  operation: () => Promise<T>,
) {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    recordRuntimeStage(stage, startedAt, recordTiming);
  }
}

export function formatRuntimeServerTiming(timings: RuntimeStageTiming[]) {
  return timings
    .map(({ durationMs, stage }) => {
      const token = stage.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      return `${token};dur=${Math.max(0, durationMs).toFixed(1)}`;
    })
    .join(", ");
}
