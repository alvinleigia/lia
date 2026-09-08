import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
} from "@/lib/conversation-contracts";
import { db } from "@/lib/db-config";
import {
  auditLogs,
  conversationalTaskVersions,
  hostedVoiceDeployments,
  hostedVoiceDeploymentVersions,
  hostedVoiceToolBindings,
  hostedVoiceToolCalls,
} from "@/lib/db-schema";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@/lib/encrypted-secrets";
import { voiceAgentDefinitionV1Schema } from "@/lib/hosted-voice-contract";
import { getHostedVoiceToolOutcome } from "@/lib/hosted-voice-runtime";
import {
  HostedVoiceToolRequestError,
  hashHostedVoiceToolValue,
} from "@/lib/hosted-voice-tool-contract";
import type {
  HostedVoiceToolCall,
  HostedVoiceToolGatewayRepository,
} from "@/lib/hosted-voice-tool-gateway";
import { evaluateHostedVoiceCandidateUat } from "@/lib/hosted-voice-uat";

export async function createHostedVoiceToolBinding(input: {
  deploymentVersionId: number;
  projectId: number;
  provider: string;
}) {
  const [version] = await db
    .select({
      definition: hostedVoiceDeploymentVersions.definition,
      deploymentId: hostedVoiceDeploymentVersions.deploymentId,
      id: hostedVoiceDeploymentVersions.id,
    })
    .from(hostedVoiceDeploymentVersions)
    .innerJoin(
      hostedVoiceDeployments,
      and(
        eq(
          hostedVoiceDeployments.id,
          hostedVoiceDeploymentVersions.deploymentId,
        ),
        eq(hostedVoiceDeployments.projectId, input.projectId),
      ),
    )
    .where(
      and(
        eq(hostedVoiceDeploymentVersions.id, input.deploymentVersionId),
        eq(hostedVoiceDeploymentVersions.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!version?.definition) {
    throw new HostedVoiceToolRequestError(
      "deployment_version_not_bindable",
      "Only a Lia-authored hosted voice version can receive tools.",
      409,
    );
  }
  voiceAgentDefinitionV1Schema.parse(version.definition);

  const credential = randomBytes(32).toString("base64url");
  const credentialHash = hashHostedVoiceToolValue(credential);
  const [binding] = await db
    .insert(hostedVoiceToolBindings)
    .values({
      credentialHash,
      deploymentId: version.deploymentId,
      deploymentVersionId: version.id,
      projectId: input.projectId,
      provider: input.provider,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [
        hostedVoiceToolBindings.deploymentVersionId,
        hostedVoiceToolBindings.provider,
      ],
      set: { credentialHash, status: "active", updatedAt: new Date() },
    })
    .returning();
  if (!binding) throw new Error("Hosted voice tool binding was not created.");
  await db.insert(auditLogs).values({
    action: "hosted_voice.tool_binding_rotated",
    metadata: {
      deploymentVersionId: version.id,
      provider: input.provider,
    },
    projectId: input.projectId,
    targetId: String(binding.id),
    targetType: "hosted_voice_tool_binding",
  });
  return { binding, credential };
}

export async function requireHostedVoiceCandidateUat(input: {
  deploymentId: number;
  projectId: number;
  provider: string;
  remoteVersionId: string;
}) {
  const [version] = await db
    .select({
      definition: hostedVoiceDeploymentVersions.definition,
      id: hostedVoiceDeploymentVersions.id,
    })
    .from(hostedVoiceDeploymentVersions)
    .where(
      and(
        eq(hostedVoiceDeploymentVersions.deploymentId, input.deploymentId),
        eq(hostedVoiceDeploymentVersions.projectId, input.projectId),
        eq(
          hostedVoiceDeploymentVersions.remoteVersionId,
          input.remoteVersionId,
        ),
        eq(hostedVoiceDeploymentVersions.source, "lia"),
        eq(hostedVoiceDeploymentVersions.status, "candidate"),
      ),
    )
    .limit(1);
  if (!version?.definition) {
    throw new Error("The Lia candidate version was not found for UAT.");
  }
  const definition = voiceAgentDefinitionV1Schema.parse(version.definition);
  const [binding] = await db
    .select({ id: hostedVoiceToolBindings.id })
    .from(hostedVoiceToolBindings)
    .where(
      and(
        eq(hostedVoiceToolBindings.deploymentId, input.deploymentId),
        eq(hostedVoiceToolBindings.deploymentVersionId, version.id),
        eq(hostedVoiceToolBindings.projectId, input.projectId),
        eq(hostedVoiceToolBindings.provider, input.provider),
        eq(hostedVoiceToolBindings.status, "active"),
      ),
    )
    .limit(1);
  if (!binding) {
    throw new Error(
      "The candidate has no active Lia tool binding. Rotate the binding and push its tools before UAT.",
    );
  }
  const rows = await db
    .select({
      access: hostedVoiceToolCalls.access,
      committedAt: hostedVoiceToolCalls.committedAt,
      outcome: hostedVoiceToolCalls.outcome,
      providerConversation: hostedVoiceToolCalls.providerConversation,
      status: hostedVoiceToolCalls.status,
      toolId: hostedVoiceToolCalls.toolId,
      toolVersion: hostedVoiceToolCalls.toolVersion,
    })
    .from(hostedVoiceToolCalls)
    .where(
      and(
        eq(hostedVoiceToolCalls.projectId, input.projectId),
        eq(hostedVoiceToolCalls.bindingId, binding.id),
      ),
    );
  const evidence = evaluateHostedVoiceCandidateUat({
    calls: rows.map((row) => ({
      access: z.enum(["read", "write"]).parse(row.access),
      committedAt: row.committedAt,
      outcome: row.outcome,
      providerConversationId: decryptSecretValue(row.providerConversation),
      status: row.status,
      toolId: row.toolId,
      toolVersion: row.toolVersion,
    })),
    requiredTools: definition.tools,
  });
  if (!evidence.passed) {
    const missing = evidence.missingTools
      .map((tool) => `${tool.id}@${tool.version}`)
      .join(", ");
    throw new Error(
      `Candidate UAT is incomplete. Successful real Telnyx tool evidence is missing for: ${missing}. Synthetic no-call probes and prepared-but-uncommitted writes do not count. Test every selected flow on this non-main candidate, then try promotion again.`,
    );
  }
  return evidence;
}

export const hostedVoiceToolGatewayRepository = {
  async resolveBinding({ credentialHash, provider, toolId }) {
    const [binding] = await db
      .select()
      .from(hostedVoiceToolBindings)
      .where(
        and(
          eq(hostedVoiceToolBindings.credentialHash, credentialHash),
          eq(hostedVoiceToolBindings.provider, provider),
          eq(hostedVoiceToolBindings.status, "active"),
        ),
      )
      .limit(1);
    if (!binding) return null;
    return resolveBindingDefinition(binding, toolId);
  },

  async reserve(input) {
    const { providerConversationId, ...call } = input;
    const [created] = await db
      .insert(hostedVoiceToolCalls)
      .values({
        ...call,
        canonicalInput: input.canonicalInput,
        providerConversation: providerConversationId
          ? encryptSecretValue(providerConversationId)
          : null,
      })
      .onConflictDoNothing()
      .returning();
    const row =
      created ??
      (
        await db
          .select()
          .from(hostedVoiceToolCalls)
          .where(
            and(
              eq(hostedVoiceToolCalls.projectId, input.projectId),
              eq(hostedVoiceToolCalls.bindingId, input.bindingId),
              eq(hostedVoiceToolCalls.providerCallId, input.providerCallId),
            ),
          )
          .limit(1)
      )[0];
    if (!row) throw new Error("Hosted voice tool call was not reserved.");
    return { call: mapCall(row), created: Boolean(created) };
  },

  async claimCommit({
    bindingId,
    executionStatus,
    now,
    projectId,
    tokenHash,
    toolId,
    toolVersion,
  }) {
    const [claimed] = await db
      .update(hostedVoiceToolCalls)
      .set({
        startedAt: executionStatus === "executing" ? now : null,
        status: executionStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(hostedVoiceToolCalls.projectId, projectId),
          eq(hostedVoiceToolCalls.bindingId, bindingId),
          eq(hostedVoiceToolCalls.toolId, toolId),
          eq(hostedVoiceToolCalls.toolVersion, toolVersion),
          eq(hostedVoiceToolCalls.phase, "prepare"),
          eq(hostedVoiceToolCalls.status, "prepared"),
          eq(hostedVoiceToolCalls.commitTokenHash, tokenHash),
          gt(hostedVoiceToolCalls.commitExpiresAt, now),
        ),
      )
      .returning();
    if (claimed) return { call: mapCall(claimed), state: "claimed" as const };
    const [existing] = await db
      .select()
      .from(hostedVoiceToolCalls)
      .where(
        and(
          eq(hostedVoiceToolCalls.projectId, projectId),
          eq(hostedVoiceToolCalls.bindingId, bindingId),
          eq(hostedVoiceToolCalls.toolId, toolId),
          eq(hostedVoiceToolCalls.toolVersion, toolVersion),
          eq(hostedVoiceToolCalls.phase, "prepare"),
          eq(hostedVoiceToolCalls.commitTokenHash, tokenHash),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (existing.status === "completed") {
      return { call: mapCall(existing), state: "completed" as const };
    }
    if (["executing", "pending"].includes(existing.status)) {
      return { call: mapCall(existing), state: "pending" as const };
    }
    if (existing.commitExpiresAt && existing.commitExpiresAt <= now) {
      return { call: mapCall(existing), state: "expired" as const };
    }
    return { call: mapCall(existing), state: "consumed" as const };
  },

  async complete({ call, committedAt, result }) {
    const completedAt = new Date();
    const [updated] = await db
      .update(hostedVoiceToolCalls)
      .set({
        committedAt: committedAt ?? null,
        completedAt,
        latencyMs: Math.max(
          0,
          completedAt.getTime() - (call.startedAt ?? call.createdAt).getTime(),
        ),
        outcome: getHostedVoiceToolOutcome(result),
        result,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(hostedVoiceToolCalls.id, call.id),
          eq(hostedVoiceToolCalls.projectId, call.projectId),
          eq(hostedVoiceToolCalls.bindingId, call.bindingId),
          inArray(hostedVoiceToolCalls.status, ["executing", "pending"]),
        ),
      )
      .returning();
    if (!updated) throw new Error("Hosted voice tool call changed.");
    await db.insert(auditLogs).values({
      action:
        call.access === "write"
          ? "hosted_voice.tool_write_committed"
          : "hosted_voice.tool_read_completed",
      metadata: {
        providerCallId: call.providerCallId,
        toolId: call.toolId,
        toolVersion: call.toolVersion,
      },
      projectId: call.projectId,
      targetId: String(call.id),
      targetType: "hosted_voice_tool_call",
    });
    return mapCall(updated);
  },

  async fail({ call, errorCode }) {
    await db
      .update(hostedVoiceToolCalls)
      .set({
        completedAt: new Date(),
        errorCode,
        outcome: "provider_unavailable",
        status: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(hostedVoiceToolCalls.id, call.id),
          eq(hostedVoiceToolCalls.projectId, call.projectId),
          eq(hostedVoiceToolCalls.bindingId, call.bindingId),
          inArray(hostedVoiceToolCalls.status, ["executing", "pending"]),
        ),
      );
    await db.insert(auditLogs).values({
      action: "hosted_voice.tool_call_failed",
      metadata: {
        errorCode,
        providerCallId: call.providerCallId,
        toolId: call.toolId,
      },
      projectId: call.projectId,
      targetId: String(call.id),
      targetType: "hosted_voice_tool_call",
    });
  },
} satisfies HostedVoiceToolGatewayRepository;

export async function claimHostedVoiceAsyncToolWork(input: {
  callId: number;
  projectId: number;
}) {
  const now = new Date();
  const [claimed] = await db
    .update(hostedVoiceToolCalls)
    .set({ startedAt: now, status: "executing", updatedAt: now })
    .where(
      and(
        eq(hostedVoiceToolCalls.id, input.callId),
        eq(hostedVoiceToolCalls.projectId, input.projectId),
        eq(hostedVoiceToolCalls.status, "pending"),
      ),
    )
    .returning();
  const row =
    claimed ??
    (
      await db
        .select()
        .from(hostedVoiceToolCalls)
        .where(
          and(
            eq(hostedVoiceToolCalls.id, input.callId),
            eq(hostedVoiceToolCalls.projectId, input.projectId),
          ),
        )
        .limit(1)
    )[0];
  if (!row || !["completed", "executing"].includes(row.status)) return null;
  const [bindingRow] = await db
    .select()
    .from(hostedVoiceToolBindings)
    .where(
      and(
        eq(hostedVoiceToolBindings.id, row.bindingId),
        eq(hostedVoiceToolBindings.projectId, input.projectId),
        eq(hostedVoiceToolBindings.status, "active"),
      ),
    )
    .limit(1);
  if (!bindingRow) return null;
  const binding = await resolveBindingDefinition(bindingRow, row.toolId);
  return binding ? { binding, call: mapCall(row) } : null;
}

export async function markHostedVoiceContinuation(input: {
  callId: number;
  errorCode?: string | null;
  projectId: number;
  status: "call_ended" | "failed" | "sent";
}) {
  await db
    .update(hostedVoiceToolCalls)
    .set({
      continuationErrorCode: input.errorCode ?? null,
      continuationSentAt: input.status === "sent" ? new Date() : null,
      continuationStatus: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hostedVoiceToolCalls.id, input.callId),
        eq(hostedVoiceToolCalls.projectId, input.projectId),
      ),
    );
}

async function resolveBindingDefinition(
  binding: typeof hostedVoiceToolBindings.$inferSelect,
  toolId: string,
) {
  const [version] = await db
    .select()
    .from(hostedVoiceDeploymentVersions)
    .where(
      and(
        eq(hostedVoiceDeploymentVersions.id, binding.deploymentVersionId),
        eq(hostedVoiceDeploymentVersions.deploymentId, binding.deploymentId),
        eq(hostedVoiceDeploymentVersions.projectId, binding.projectId),
      ),
    )
    .limit(1);
  if (!version?.definition) return null;
  const voiceDefinition = voiceAgentDefinitionV1Schema.parse(
    version.definition,
  );
  const toolRef = voiceDefinition.tools.find(({ id }) => id === toolId);
  if (!toolRef) return null;
  const taskVersionIds = voiceDefinition.publishedTaskVersions.map(
    ({ taskVersionId }) => taskVersionId,
  );
  if (taskVersionIds.length === 0) return null;
  const snapshots = await db
    .select({ snapshot: conversationalTaskVersions.snapshot })
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, binding.projectId),
        inArray(conversationalTaskVersions.id, taskVersionIds),
      ),
    );
  const definitions = snapshots
    .map(({ snapshot }) => conversationalTaskSnapshotV1Schema.parse(snapshot))
    .flatMap((snapshot: ConversationalTaskSnapshotV1) =>
      snapshot.toolDefinitions.filter(
        (definition) =>
          definition.id === toolRef.id &&
          definition.version === toolRef.version &&
          definition.projectId === binding.projectId,
      ),
    );
  if (definitions.length === 0) return null;
  if (
    definitions.some(
      (definition) =>
        hashHostedVoiceToolValue(definition) !==
        hashHostedVoiceToolValue(definitions[0]),
    )
  ) {
    throw new HostedVoiceToolRequestError(
      "ambiguous_tool_definition",
      "The pinned tool definition is inconsistent across task versions.",
      409,
    );
  }
  return {
    definition: definitions[0],
    deploymentId: binding.deploymentId,
    id: binding.id,
    locale: voiceDefinition.locale.language,
    projectId: binding.projectId,
    provider: binding.provider,
    timezone: voiceDefinition.locale.timezone,
  };
}

const callStatusSchema = z.enum([
  "cancelled",
  "completed",
  "executing",
  "failed",
  "pending",
  "prepared",
]);

function mapCall(
  row: typeof hostedVoiceToolCalls.$inferSelect,
): HostedVoiceToolCall {
  return {
    access: z.enum(["read", "write"]).parse(row.access),
    bindingId: row.bindingId,
    canonicalInput: row.canonicalInput,
    canonicalInputHash: row.canonicalInputHash,
    commitExpiresAt: row.commitExpiresAt,
    commitTokenHash: row.commitTokenHash,
    createdAt: row.createdAt,
    id: row.id,
    phase: z.enum(["prepare", "read"]).parse(row.phase),
    projectId: row.projectId,
    providerCallId: row.providerCallId,
    providerConversationHash: row.providerConversationHash,
    providerConversationId: decryptSecretValue(row.providerConversation),
    result: row.result,
    status: callStatusSchema.parse(row.status),
    startedAt: row.startedAt,
    toolId: row.toolId,
    toolVersion: row.toolVersion,
  };
}
