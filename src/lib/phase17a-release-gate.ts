export const PHASE17A_RELEASE_AUDIT_ACTION =
  "phase17a.optimization_release_evaluated";
export const PHASE17A_RELEASE_TARGET_TYPE = "phase17a_optimization_release";
export const PHASE17A_BASELINE_AUDIT_ACTION =
  "phase17a.optimization_baseline_recorded";
export const PHASE17A_BASELINE_TARGET_TYPE = "phase17a_optimization_baseline";

export type Phase17aEfficiencyMetrics = {
  averageRequestLatencyMs: number | null;
  attemptsPerCompletion: number | null;
  modelTurnRate: number | null;
  retryFallbackRate: number | null;
  tokensPerDirectChat: number | null;
};

export type Phase17aBaselineMetrics = Phase17aEfficiencyMetrics;

const METRIC_LABELS: Record<keyof Phase17aEfficiencyMetrics, string> = {
  averageRequestLatencyMs: "Average request latency",
  attemptsPerCompletion: "Attempts per completion",
  modelTurnRate: "Structured model rate",
  retryFallbackRate: "Retry / fallback rate",
  tokensPerDirectChat: "Tokens per direct AI chat",
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function parseNullableMetrics(
  value: unknown,
): Phase17aEfficiencyMetrics | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed = {} as Phase17aEfficiencyMetrics;

  for (const key of Object.keys(METRIC_LABELS) as Array<
    keyof Phase17aEfficiencyMetrics
  >) {
    const metric = record[key];
    const parsedMetric = metric === null ? null : finiteNumber(metric);
    if (metric !== null && parsedMetric === null) return null;
    parsed[key] = parsedMetric;
  }

  return parsed;
}

export function buildPhase17aCandidateMetrics(input: {
  averageRequestLatencyMs: number;
  attemptsPerCompletion: number;
  completionCount: number;
  directAiChats: number;
  modelTurnRate: number;
  retryFallbackRate: number;
  structuredTurns: number;
  totalTokens: number;
}) {
  return {
    averageRequestLatencyMs:
      input.directAiChats > 0 ? input.averageRequestLatencyMs : null,
    attemptsPerCompletion:
      input.completionCount > 0 ? input.attemptsPerCompletion : null,
    modelTurnRate: input.structuredTurns > 0 ? input.modelTurnRate : null,
    retryFallbackRate:
      input.structuredTurns > 0 ? input.retryFallbackRate : null,
    tokensPerDirectChat:
      input.directAiChats > 0 ? input.totalTokens / input.directAiChats : null,
  } satisfies Phase17aEfficiencyMetrics;
}

export function summarizePhase17aReleaseGate(input: {
  baseline: Phase17aBaselineMetrics;
  candidate: Phase17aEfficiencyMetrics;
  evaluationReady: boolean;
}) {
  const comparisons = (
    Object.keys(METRIC_LABELS) as Array<keyof Phase17aEfficiencyMetrics>
  ).map((key) => {
    const baseline = input.baseline[key];
    const candidate = input.candidate[key];
    const reductionPercent =
      candidate === null || baseline === null || baseline <= 0
        ? null
        : ((baseline - candidate) / baseline) * 100;

    return {
      key,
      label: METRIC_LABELS[key],
      baseline,
      candidate,
      reductionPercent,
      improved: reductionPercent !== null && reductionPercent > 0,
    };
  });
  const improvedMetrics = comparisons.filter((metric) => metric.improved);
  const comparableMetrics = comparisons.filter(
    (metric) => metric.reductionPercent !== null,
  );

  return {
    comparisons,
    improvedMetrics,
    comparableMetrics,
    evaluationReady: input.evaluationReady,
    efficiencyReady: improvedMetrics.length > 0,
    ready: input.evaluationReady && improvedMetrics.length > 0,
  };
}

export type Phase17aReleaseAuditRecord = {
  baseline: Phase17aBaselineMetrics;
  baselineCapturedAt: string | null;
  candidate: Phase17aEfficiencyMetrics;
  candidateLabel: string;
  candidateReference: string;
  candidateWindowEndedAt: string | null;
  candidateWindowStartedAt: string | null;
  evaluationReady: boolean;
  improvedMetricLabels: string[];
  ready: boolean;
  rollbackReference: string;
};

export type Phase17aBaselineAuditRecord = {
  capturedAt: string;
  metrics: Phase17aBaselineMetrics;
  windowEndedAt: string;
  windowStartedAt: string;
};

export function parsePhase17aBaselineAuditRecord(
  metadata: Record<string, unknown>,
): Phase17aBaselineAuditRecord | null {
  if (metadata.schemaVersion !== 1) return null;
  const metrics = parseNullableMetrics(metadata.metrics);
  if (
    !metrics ||
    !isIsoDateTime(metadata.capturedAt) ||
    !isIsoDateTime(metadata.windowStartedAt) ||
    !isIsoDateTime(metadata.windowEndedAt)
  ) {
    return null;
  }

  return {
    capturedAt: metadata.capturedAt,
    metrics,
    windowEndedAt: metadata.windowEndedAt,
    windowStartedAt: metadata.windowStartedAt,
  };
}

export function parsePhase17aReleaseAuditRecord(
  metadata: Record<string, unknown>,
): Phase17aReleaseAuditRecord | null {
  const schemaVersion = metadata.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) return null;
  const parsedBaseline = parseNullableMetrics(metadata.baseline);
  const parsedCandidate = parseNullableMetrics(metadata.candidate);
  if (!parsedBaseline || !parsedCandidate) return null;
  const candidateLabel = metadata.candidateLabel;
  const candidateReference = metadata.candidateReference;
  const rollbackReference = metadata.rollbackReference;
  const improvedMetricLabels = metadata.improvedMetricLabels;
  let baselineCapturedAt: string | null = null;
  let candidateWindowStartedAt: string | null = null;
  let candidateWindowEndedAt: string | null = null;
  if (schemaVersion === 2) {
    if (
      !isIsoDateTime(metadata.baselineCapturedAt) ||
      !isIsoDateTime(metadata.candidateWindowStartedAt) ||
      !isIsoDateTime(metadata.candidateWindowEndedAt)
    ) {
      return null;
    }
    baselineCapturedAt = metadata.baselineCapturedAt;
    candidateWindowStartedAt = metadata.candidateWindowStartedAt;
    candidateWindowEndedAt = metadata.candidateWindowEndedAt;
  }
  if (
    typeof candidateLabel !== "string" ||
    typeof candidateReference !== "string" ||
    typeof rollbackReference !== "string" ||
    !Array.isArray(improvedMetricLabels) ||
    !improvedMetricLabels.every((value) => typeof value === "string") ||
    typeof metadata.evaluationReady !== "boolean" ||
    typeof metadata.ready !== "boolean"
  ) {
    return null;
  }

  return {
    baseline: parsedBaseline,
    baselineCapturedAt,
    candidate: parsedCandidate,
    candidateLabel,
    candidateReference,
    candidateWindowEndedAt,
    candidateWindowStartedAt,
    evaluationReady: metadata.evaluationReady,
    improvedMetricLabels,
    ready: metadata.ready,
    rollbackReference,
  };
}
