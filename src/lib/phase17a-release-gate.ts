export const PHASE17A_RELEASE_AUDIT_ACTION =
  "phase17a.optimization_release_evaluated";
export const PHASE17A_RELEASE_TARGET_TYPE = "phase17a_optimization_release";

export type Phase17aEfficiencyMetrics = {
  averageRequestLatencyMs: number | null;
  attemptsPerCompletion: number | null;
  modelTurnRate: number | null;
  retryFallbackRate: number | null;
  tokensPerDirectChat: number | null;
};

export type Phase17aBaselineMetrics = {
  averageRequestLatencyMs: number;
  attemptsPerCompletion: number;
  modelTurnRate: number;
  retryFallbackRate: number;
  tokensPerDirectChat: number;
};

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
      candidate === null || baseline <= 0
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
  candidate: Phase17aEfficiencyMetrics;
  candidateLabel: string;
  candidateReference: string;
  evaluationReady: boolean;
  improvedMetricLabels: string[];
  ready: boolean;
  rollbackReference: string;
};

export function parsePhase17aReleaseAuditRecord(
  metadata: Record<string, unknown>,
): Phase17aReleaseAuditRecord | null {
  if (metadata.schemaVersion !== 1) return null;
  const baseline = metadata.baseline;
  const candidate = metadata.candidate;
  if (!baseline || typeof baseline !== "object") return null;
  if (!candidate || typeof candidate !== "object") return null;

  const baselineRecord = baseline as Record<string, unknown>;
  const candidateRecord = candidate as Record<string, unknown>;
  const parsedBaseline = {
    averageRequestLatencyMs: finiteNumber(
      baselineRecord.averageRequestLatencyMs,
    ),
    attemptsPerCompletion: finiteNumber(baselineRecord.attemptsPerCompletion),
    modelTurnRate: finiteNumber(baselineRecord.modelTurnRate),
    retryFallbackRate: finiteNumber(baselineRecord.retryFallbackRate),
    tokensPerDirectChat: finiteNumber(baselineRecord.tokensPerDirectChat),
  };
  if (Object.values(parsedBaseline).some((value) => value === null)) {
    return null;
  }

  const parsedCandidate = {
    averageRequestLatencyMs: finiteNumber(
      candidateRecord.averageRequestLatencyMs,
    ),
    attemptsPerCompletion: finiteNumber(candidateRecord.attemptsPerCompletion),
    modelTurnRate: finiteNumber(candidateRecord.modelTurnRate),
    retryFallbackRate: finiteNumber(candidateRecord.retryFallbackRate),
    tokensPerDirectChat: finiteNumber(candidateRecord.tokensPerDirectChat),
  };
  const candidateLabel = metadata.candidateLabel;
  const candidateReference = metadata.candidateReference;
  const rollbackReference = metadata.rollbackReference;
  const improvedMetricLabels = metadata.improvedMetricLabels;
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
    baseline: parsedBaseline as Phase17aBaselineMetrics,
    candidate: parsedCandidate,
    candidateLabel,
    candidateReference,
    evaluationReady: metadata.evaluationReady,
    improvedMetricLabels,
    ready: metadata.ready,
    rollbackReference,
  };
}
