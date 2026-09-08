import { expect, test } from "@playwright/test";
import { getTelnyxHostedVoiceCandidateSecretIdentifier } from "../../src/lib/hosted-voice-staging";
import { evaluateHostedVoiceCandidateUat } from "../../src/lib/hosted-voice-uat";

const requiredTools = [
  { id: "operation_85", version: 1 },
  { id: "operation_86", version: 1 },
];

test("each candidate receives a different Telnyx Integration Secret identifier", () => {
  expect(getTelnyxHostedVoiceCandidateSecretIdentifier(41)).toBe(
    "lia-phase18-candidate-41",
  );
  expect(getTelnyxHostedVoiceCandidateSecretIdentifier(42)).not.toBe(
    getTelnyxHostedVoiceCandidateSecretIdentifier(41),
  );
});

test("candidate UAT requires successful real calls for every pinned tool", () => {
  const evidence = evaluateHostedVoiceCandidateUat({
    calls: [
      {
        access: "read",
        committedAt: null,
        outcome: "success",
        providerConversationId: "call-control-real",
        status: "completed",
        toolId: "operation_85",
        toolVersion: 1,
      },
      {
        access: "write",
        committedAt: null,
        outcome: null,
        providerConversationId: "call-control-real",
        status: "prepared",
        toolId: "operation_86",
        toolVersion: 1,
      },
    ],
    requiredTools,
  });

  expect(evidence).toEqual({
    missingTools: [{ id: "operation_86", version: 1 }],
    passed: false,
    requiredToolCount: 2,
    verifiedToolCount: 1,
  });
});

test("candidate UAT ignores synthetic probes and unsuccessful read outcomes", () => {
  const evidence = evaluateHostedVoiceCandidateUat({
    calls: [
      {
        access: "read",
        committedAt: null,
        outcome: "success",
        providerConversationId: "lia-no-call:verification-id",
        status: "completed",
        toolId: "operation_85",
        toolVersion: 1,
      },
      {
        access: "read",
        committedAt: null,
        outcome: "not_found",
        providerConversationId: "call-control-real",
        status: "completed",
        toolId: "operation_85",
        toolVersion: 1,
      },
    ],
    requiredTools: [{ id: "operation_85", version: 1 }],
  });

  expect(evidence.passed).toBe(false);
  expect(evidence.verifiedToolCount).toBe(0);
});

test("candidate UAT passes only after the write was committed successfully", () => {
  const evidence = evaluateHostedVoiceCandidateUat({
    calls: [
      {
        access: "read",
        committedAt: null,
        outcome: "success",
        providerConversationId: "call-control-read",
        status: "completed",
        toolId: "operation_85",
        toolVersion: 1,
      },
      {
        access: "write",
        committedAt: new Date("2026-09-08T10:05:00.000Z"),
        outcome: "success",
        providerConversationId: "call-control-write",
        status: "completed",
        toolId: "operation_86",
        toolVersion: 1,
      },
    ],
    requiredTools: [...requiredTools, requiredTools[0]],
  });

  expect(evidence).toEqual({
    missingTools: [],
    passed: true,
    requiredToolCount: 2,
    verifiedToolCount: 2,
  });
});
