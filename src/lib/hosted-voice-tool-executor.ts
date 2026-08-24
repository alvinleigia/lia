import { enqueueDurableJob } from "@/lib/durable-jobs";
import type { HostedVoiceToolExecutor } from "@/lib/hosted-voice-tool-gateway";
import { runOperationForHostedVoiceTool } from "@/lib/operations";

export const hostedVoiceToolExecutor = {
  async enqueue({ callId, projectId }) {
    await enqueueDurableJob({
      dedupeKey: `hosted-voice-tool:${callId}`,
      jobType: "hosted_voice_tool",
      payload: { callId },
      projectId,
    });
  },
  async execute({ definition, idempotencyKey, payload, projectId }) {
    if (definition.execution.adapter !== "operation") {
      throw new Error("The hosted voice tool executor is unavailable.");
    }
    const operationId = Number(definition.execution.handler);
    if (!Number.isInteger(operationId) || operationId <= 0) {
      throw new Error("The hosted voice operation binding is invalid.");
    }
    const result = await runOperationForHostedVoiceTool({
      idempotencyKey,
      operationId,
      payload,
      projectId,
    });
    if (!result) {
      throw new Error("The hosted voice operation did not complete.");
    }
    return result;
  },
} satisfies HostedVoiceToolExecutor;
