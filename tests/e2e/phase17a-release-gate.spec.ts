import { expect, test } from "@playwright/test";
import {
  buildPhase17aCandidateMetrics,
  parsePhase17aReleaseAuditRecord,
  summarizePhase17aReleaseGate,
} from "../../src/lib/phase17a-release-gate";

test("phase 17a gate requires efficiency improvement and evaluation approval", () => {
  const baseline = {
    averageRequestLatencyMs: 1200,
    attemptsPerCompletion: 1.5,
    modelTurnRate: 80,
    retryFallbackRate: 20,
    tokensPerDirectChat: 900,
  };
  const candidate = {
    averageRequestLatencyMs: 800,
    attemptsPerCompletion: 1.2,
    modelTurnRate: 60,
    retryFallbackRate: 10,
    tokensPerDirectChat: 600,
  };

  expect(
    summarizePhase17aReleaseGate({
      baseline,
      candidate,
      evaluationReady: false,
    }).ready,
  ).toBe(false);

  const ready = summarizePhase17aReleaseGate({
    baseline,
    candidate,
    evaluationReady: true,
  });
  expect(ready.ready).toBe(true);
  expect(ready.improvedMetrics.map((metric) => metric.key)).toContain(
    "tokensPerDirectChat",
  );
});

test("phase 17a gate does not treat missing candidate telemetry as improvement", () => {
  const gate = summarizePhase17aReleaseGate({
    baseline: {
      averageRequestLatencyMs: 1200,
      attemptsPerCompletion: 1.5,
      modelTurnRate: 80,
      retryFallbackRate: 20,
      tokensPerDirectChat: 900,
    },
    candidate: {
      averageRequestLatencyMs: null,
      attemptsPerCompletion: null,
      modelTurnRate: null,
      retryFallbackRate: null,
      tokensPerDirectChat: null,
    },
    evaluationReady: true,
  });

  expect(gate.ready).toBe(false);
  expect(gate.comparableMetrics).toHaveLength(0);
});

test("candidate metrics expose unavailable denominators honestly", () => {
  expect(
    buildPhase17aCandidateMetrics({
      averageRequestLatencyMs: 0,
      attemptsPerCompletion: 0,
      completionCount: 0,
      directAiChats: 0,
      modelTurnRate: 0,
      retryFallbackRate: 0,
      structuredTurns: 0,
      totalTokens: 0,
    }),
  ).toEqual({
    averageRequestLatencyMs: null,
    attemptsPerCompletion: null,
    modelTurnRate: null,
    retryFallbackRate: null,
    tokensPerDirectChat: null,
  });
});

test("phase 17a audit metadata parser rejects incomplete records", () => {
  expect(parsePhase17aReleaseAuditRecord({ schemaVersion: 1 })).toBeNull();
  expect(
    parsePhase17aReleaseAuditRecord({
      schemaVersion: 1,
      baseline: {
        averageRequestLatencyMs: 1200,
        attemptsPerCompletion: 1.5,
        modelTurnRate: 80,
        retryFallbackRate: 20,
        tokensPerDirectChat: 900,
      },
      candidate: {
        averageRequestLatencyMs: 800,
        attemptsPerCompletion: 1.2,
        modelTurnRate: 60,
        retryFallbackRate: 10,
        tokensPerDirectChat: 600,
      },
      candidateLabel: "phase-17a",
      candidateReference: "commit-candidate",
      rollbackReference: "commit-baseline",
      evaluationReady: true,
      improvedMetricLabels: ["Tokens per direct AI chat"],
      ready: true,
    }),
  ).toMatchObject({
    candidateLabel: "phase-17a",
    ready: true,
    rollbackReference: "commit-baseline",
  });
});
