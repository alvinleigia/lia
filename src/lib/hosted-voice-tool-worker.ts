import { z } from "zod";
import {
  claimNextDurableJob,
  completeDurableJob,
  failDurableJob,
} from "@/lib/durable-jobs";
import {
  createHostedVoiceContinuationMessage,
  getHostedVoiceToolOutcome,
} from "@/lib/hosted-voice-runtime";
import { hostedVoiceToolExecutor } from "@/lib/hosted-voice-tool-executor";
import {
  executeAndCompleteHostedVoiceTool,
  type HostedVoiceToolGatewayRepository,
} from "@/lib/hosted-voice-tool-gateway";
import {
  claimHostedVoiceAsyncToolWork,
  hostedVoiceToolGatewayRepository,
  markHostedVoiceContinuation,
} from "@/lib/hosted-voice-tool-store";
import {
  sendTelnyxHostedVoiceContinuation,
  TelnyxHostedVoiceContinuationError,
} from "@/lib/telnyx-hosted-voice-continuation";
import { getProjectTelnyxHostedVoiceRuntime } from "@/lib/telnyx-hosted-voice-provider";

const jobPayloadSchema = z.object({ callId: z.number().int().positive() });

export async function processProjectHostedVoiceToolQueue(input: {
  maxJobs: number;
  projectId: number;
  workerId: string;
}) {
  let completed = 0;
  let failed = 0;
  let processed = 0;

  for (let index = 0; index < input.maxJobs; index += 1) {
    const job = await claimNextDurableJob({
      jobTypes: ["hosted_voice_tool"],
      projectId: input.projectId,
      workerId: input.workerId,
    });
    if (!job) break;
    processed += 1;
    try {
      const { callId } = jobPayloadSchema.parse(job.payload);
      const work = await claimHostedVoiceAsyncToolWork({
        callId,
        projectId: input.projectId,
      });
      if (!work || !work.call.providerConversationId) {
        throw new PermanentHostedVoiceToolError("tool_work_unavailable");
      }

      let result = work.call.result;
      if (work.call.status !== "completed" || !result) {
        const execution = await executeAndCompleteHostedVoiceTool({
          binding: work.binding,
          call: work.call,
          executor: hostedVoiceToolExecutor,
          now: new Date(),
          repository:
            hostedVoiceToolGatewayRepository as HostedVoiceToolGatewayRepository,
        });
        result = execution.result;
      }

      const runtime = await getProjectTelnyxHostedVoiceRuntime({
        deploymentId: work.binding.deploymentId,
        projectId: input.projectId,
      });
      if (!runtime) {
        throw new PermanentHostedVoiceToolError("provider_unavailable");
      }
      const outcome = getHostedVoiceToolOutcome(result);
      try {
        await sendTelnyxHostedVoiceContinuation({
          apiKey: runtime.apiKey,
          callControlId: work.call.providerConversationId,
          message: createHostedVoiceContinuationMessage({
            outcome,
            requestId: work.call.providerCallId,
            result,
          }),
          requestId: `hosted-voice-tool:${work.call.id}:${outcome}`,
        });
        await markHostedVoiceContinuation({
          callId: work.call.id,
          projectId: input.projectId,
          status: "sent",
        });
      } catch (error) {
        if (
          error instanceof TelnyxHostedVoiceContinuationError &&
          error.code === "call_ended"
        ) {
          await markHostedVoiceContinuation({
            callId: work.call.id,
            errorCode: error.code,
            projectId: input.projectId,
            status: "call_ended",
          });
        } else {
          await markHostedVoiceContinuation({
            callId: work.call.id,
            errorCode:
              error instanceof TelnyxHostedVoiceContinuationError
                ? error.code
                : "provider_unavailable",
            projectId: input.projectId,
            status: "failed",
          });
          throw error;
        }
      }

      await completeDurableJob({
        jobId: job.id,
        projectId: input.projectId,
        result: { callId, outcome },
        workerId: input.workerId,
      });
      completed += 1;
    } catch (error) {
      const permanent =
        error instanceof PermanentHostedVoiceToolError ||
        (error instanceof TelnyxHostedVoiceContinuationError &&
          !error.retryable);
      await failDurableJob({
        errorMessage:
          error instanceof PermanentHostedVoiceToolError
            ? error.code
            : error instanceof TelnyxHostedVoiceContinuationError
              ? error.code
              : "hosted_voice_tool_failed",
        jobId: job.id,
        permanent,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
    }
  }

  return { completed, failed, processed };
}

class PermanentHostedVoiceToolError extends Error {
  constructor(readonly code: string) {
    super("Hosted voice tool work cannot continue.");
    this.name = "PermanentHostedVoiceToolError";
  }
}
