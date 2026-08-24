import { z } from "zod";

export const HOSTED_VOICE_TOOL_OUTCOMES = [
  "success",
  "conflict",
  "not_found",
  "ambiguous",
  "pending",
  "outcome_unknown",
  "provider_unavailable",
] as const;

export type HostedVoiceToolOutcome =
  (typeof HOSTED_VOICE_TOOL_OUTCOMES)[number];

export function getHostedVoiceToolOutcome(
  value: Record<string, unknown>,
): HostedVoiceToolOutcome {
  const status = readStatus(value);
  const reason = typeof value.reason === "string" ? value.reason : "";

  if (status === "pending") return "pending";
  if (status === "outcome_unknown") return "outcome_unknown";
  if (
    status === "provider_failure" ||
    status === "failed" ||
    status === "timeout" ||
    status === "timed_out" ||
    status === "provider_unavailable"
  ) {
    return "provider_unavailable";
  }
  if (
    status === "conflict" ||
    reason === "slot_taken" ||
    reason === "appointment_changed"
  ) {
    return "conflict";
  }
  if (
    status === "not_found" ||
    status === "no_result" ||
    reason === "appointment_not_found"
  ) {
    return "not_found";
  }
  if (status === "ambiguous" || status === "rejected") return "ambiguous";
  if (["available", "completed", "success"].includes(status)) return "success";
  return "ambiguous";
}

export function createHostedVoiceContinuationMessage(input: {
  outcome: HostedVoiceToolOutcome;
  requestId: string;
  result?: Record<string, unknown>;
}) {
  const instruction = OUTCOME_INSTRUCTIONS[input.outcome];
  const safeResult = input.result ? safeContinuationResult(input.result) : {};
  return [
    `<lia_tool_result request_id="${input.requestId}" outcome="${input.outcome}">`,
    instruction,
    Object.keys(safeResult).length > 0
      ? `Verified data: ${JSON.stringify(safeResult)}`
      : "",
    "Treat this result as authoritative. Do not invent a different outcome.",
    "</lia_tool_result>",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getHostedVoiceInterruptionDecision(input: {
  access: "read" | "write";
  cancellation: "supported" | "best_effort" | "unsupported";
  status:
    | "cancelled"
    | "completed"
    | "executing"
    | "failed"
    | "pending"
    | "prepared";
}) {
  if (input.access === "write" && input.status !== "prepared") {
    return "continue_committed_write" as const;
  }
  if (
    input.access === "read" &&
    input.status === "pending" &&
    input.cancellation !== "unsupported"
  ) {
    return "cancel_pending_read" as const;
  }
  return "no_action" as const;
}

export function getLatencyPercentiles(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map(Math.round)
    .sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

export function resolveHostedVoiceVersionAttribution(input: {
  currentMainVersionId: number | null;
  toolVersionIds: Array<number | null>;
}) {
  const toolVersionIds = [
    ...new Set(input.toolVersionIds.filter((value) => value !== null)),
  ];
  if (toolVersionIds.length === 1) {
    return {
      deploymentVersionId: toolVersionIds[0] ?? null,
      source: "tool_binding" as const,
    };
  }
  if (toolVersionIds.length > 1) {
    return { deploymentVersionId: null, source: "ambiguous" as const };
  }
  return {
    deploymentVersionId: input.currentMainVersionId,
    source: input.currentMainVersionId
      ? ("current_main_at_sync" as const)
      : ("unavailable" as const),
  };
}

export function getHostedVoiceCallMetrics(input: {
  costRateMicrounitsPerMinute: number;
  durationMs: number;
  endReason: string;
  tools: Array<{
    interrupted: boolean;
    latencyMs: number | null;
    outcome: string | null;
  }>;
}) {
  const latency = getLatencyPercentiles(
    input.tools.flatMap(({ latencyMs }) =>
      latencyMs === null ? [] : [latencyMs],
    ),
  );
  const toolOutcomeCounts = Object.fromEntries(
    HOSTED_VOICE_TOOL_OUTCOMES.map((outcome) => [
      outcome,
      input.tools.filter(({ outcome: actual }) => actual === outcome).length,
    ]),
  ) as Record<HostedVoiceToolOutcome, number>;
  return {
    estimatedCostMicrounits: Math.round(
      (input.durationMs * input.costRateMicrounitsPerMinute) / 60_000,
    ),
    toolInterruptionCount: input.tools.filter(({ interrupted }) => interrupted)
      .length,
    toolLatencyP50Ms: latency.p50,
    toolLatencyP95Ms: latency.p95,
    toolLatencyP99Ms: latency.p99,
    toolOutcomeCounts,
    transferred: input.endReason.toLowerCase().includes("transfer"),
  };
}

const OUTCOME_INSTRUCTIONS: Record<HostedVoiceToolOutcome, string> = {
  ambiguous:
    "The result is ambiguous. Ask one focused question before taking another action.",
  conflict:
    "The requested option is no longer available. Apologize briefly and offer another option.",
  not_found:
    "No matching record was found. Ask the caller to verify the identifying details.",
  outcome_unknown:
    "The write may have happened, but Lia cannot verify it yet. Do not claim success or retry the write automatically.",
  pending:
    "The work is still pending. Tell the caller it is being checked and continue helping without claiming completion.",
  provider_unavailable:
    "The provider is currently unavailable. Do not claim success; offer a later retry or an approved handoff.",
  success:
    "The operation completed and was verified. Share the verified result.",
};

const continuationResultSchema = z.record(
  z.string().max(120),
  z.union([
    z.string().max(1_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z
      .array(z.union([z.string().max(1_000), z.number().finite(), z.boolean()]))
      .max(20),
  ]),
);

function safeContinuationResult(value: Record<string, unknown>) {
  const parsed = continuationResultSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function readStatus(value: Record<string, unknown>) {
  for (const candidate of [value.status, value.outcome]) {
    if (typeof candidate === "string") return candidate.toLowerCase();
  }
  return "";
}

function percentile(sorted: number[], quantile: number) {
  if (sorted.length === 0) return null;
  return (
    sorted[Math.ceil(sorted.length * quantile) - 1] ?? sorted.at(-1) ?? null
  );
}
