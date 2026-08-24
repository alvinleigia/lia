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
import { voiceAgentDefinitionV1Schema } from "@/lib/hosted-voice-contract";
import {
  HostedVoiceToolRequestError,
  hashHostedVoiceToolValue,
} from "@/lib/hosted-voice-tool-contract";
import type {
  HostedVoiceToolCall,
  HostedVoiceToolGatewayRepository,
} from "@/lib/hosted-voice-tool-gateway";

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
  },

  async reserve(input) {
    const [created] = await db
      .insert(hostedVoiceToolCalls)
      .values({
        ...input,
        canonicalInput: input.canonicalInput,
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

  async claimCommit({ bindingId, now, projectId, providerCallId, tokenHash }) {
    const [claimed] = await db
      .update(hostedVoiceToolCalls)
      .set({ status: "executing", updatedAt: now })
      .where(
        and(
          eq(hostedVoiceToolCalls.projectId, projectId),
          eq(hostedVoiceToolCalls.bindingId, bindingId),
          eq(hostedVoiceToolCalls.providerCallId, providerCallId),
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
          eq(hostedVoiceToolCalls.providerCallId, providerCallId),
          eq(hostedVoiceToolCalls.commitTokenHash, tokenHash),
          eq(hostedVoiceToolCalls.status, "completed"),
        ),
      )
      .limit(1);
    return existing
      ? { call: mapCall(existing), state: "completed" as const }
      : null;
  },

  async complete({ call, committedAt, result }) {
    const [updated] = await db
      .update(hostedVoiceToolCalls)
      .set({
        committedAt: committedAt ?? null,
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
      .set({ errorCode, status: "failed", updatedAt: new Date() })
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

const callStatusSchema = z.enum([
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
    id: row.id,
    phase: z.enum(["prepare", "read"]).parse(row.phase),
    projectId: row.projectId,
    providerCallId: row.providerCallId,
    result: row.result,
    status: callStatusSchema.parse(row.status),
    toolId: row.toolId,
    toolVersion: row.toolVersion,
  };
}
