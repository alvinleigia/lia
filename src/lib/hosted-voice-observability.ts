import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  auditLogs,
  hostedVoiceCallObservations,
  hostedVoiceToolBindings,
  hostedVoiceToolCalls,
} from "@/lib/db-schema";
import {
  getHostedVoiceCallMetrics,
  resolveHostedVoiceVersionAttribution,
} from "@/lib/hosted-voice-runtime";
import { hashHostedVoiceToolValue } from "@/lib/hosted-voice-tool-contract";
import type { getTelnyxHostedVoiceConversationEnded } from "@/lib/telnyx-hosted-voice-events";

type ConversationEnded = NonNullable<
  ReturnType<typeof getTelnyxHostedVoiceConversationEnded>
>;

export async function recordHostedVoicePostCallObservation(input: {
  costRateMicrounitsPerMinute: number;
  deploymentId: number;
  deploymentVersionId: number | null;
  event: ConversationEnded;
  projectId: number;
  provider: string;
  retentionDays: number;
}) {
  await db
    .delete(hostedVoiceCallObservations)
    .where(
      and(
        eq(hostedVoiceCallObservations.projectId, input.projectId),
        lte(hostedVoiceCallObservations.expiresAt, new Date()),
      ),
    );
  const providerConversationHash = hashHostedVoiceToolValue(
    input.event.callControlId,
  );
  const tools = await db
    .select({
      deploymentVersionId: hostedVoiceToolBindings.deploymentVersionId,
      interruptedAt: hostedVoiceToolCalls.interruptedAt,
      latencyMs: hostedVoiceToolCalls.latencyMs,
      outcome: hostedVoiceToolCalls.outcome,
    })
    .from(hostedVoiceToolCalls)
    .innerJoin(
      hostedVoiceToolBindings,
      and(
        eq(hostedVoiceToolBindings.id, hostedVoiceToolCalls.bindingId),
        eq(hostedVoiceToolBindings.projectId, input.projectId),
        eq(hostedVoiceToolBindings.deploymentId, input.deploymentId),
      ),
    )
    .where(
      and(
        eq(hostedVoiceToolCalls.projectId, input.projectId),
        eq(
          hostedVoiceToolCalls.providerConversationHash,
          providerConversationHash,
        ),
      ),
    );
  const versionAttribution = resolveHostedVoiceVersionAttribution({
    currentMainVersionId: input.deploymentVersionId,
    toolVersionIds: tools.map((tool) => tool.deploymentVersionId),
  });
  const metrics = getHostedVoiceCallMetrics({
    costRateMicrounitsPerMinute: input.costRateMicrounitsPerMinute,
    durationMs: input.event.durationMs,
    endReason: input.event.reason,
    tools: tools.map((tool) => ({
      interrupted: Boolean(tool.interruptedAt),
      latencyMs: tool.latencyMs,
      outcome: tool.outcome,
    })),
  });
  const [created] = await db
    .insert(hostedVoiceCallObservations)
    .values({
      costRateMicrounitsPerMinute: input.costRateMicrounitsPerMinute,
      deploymentId: input.deploymentId,
      deploymentVersionId: versionAttribution.deploymentVersionId,
      durationMs: input.event.durationMs,
      endedAt: input.event.endedAt,
      endReason: input.event.reason,
      estimatedCostMicrounits: metrics.estimatedCostMicrounits,
      expiresAt: new Date(
        input.event.endedAt.getTime() + input.retentionDays * 86_400_000,
      ),
      toolInterruptionCount: metrics.toolInterruptionCount,
      llmModel: input.event.llmModel,
      projectId: input.projectId,
      provider: input.provider,
      providerConversationHash,
      providerEventId: input.event.eventId,
      sttModel: input.event.sttModel,
      toolLatencyP50Ms: metrics.toolLatencyP50Ms,
      toolLatencyP95Ms: metrics.toolLatencyP95Ms,
      toolLatencyP99Ms: metrics.toolLatencyP99Ms,
      toolOutcomeCounts: metrics.toolOutcomeCounts,
      transferred: metrics.transferred,
      ttsModel: input.event.ttsModel,
      ttsProvider: input.event.ttsProvider,
      versionAttribution: versionAttribution.source,
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await db.insert(auditLogs).values({
      action: "hosted_voice.post_call_synchronized",
      metadata: {
        deploymentVersionId: versionAttribution.deploymentVersionId,
        versionAttribution: versionAttribution.source,
        durationMs: input.event.durationMs,
        provider: input.provider,
        toolOutcomeCounts: metrics.toolOutcomeCounts,
      },
      projectId: input.projectId,
      targetId: String(created.id),
      targetType: "hosted_voice_call_observation",
    });
  }
  return created ?? null;
}
