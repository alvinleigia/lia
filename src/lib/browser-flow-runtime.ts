import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import type { ActiveActionFlow } from "@/lib/action-runtime";
import {
  findTriggeredAction,
  getRunnableActionSteps,
  isActionConfirmationStep,
  type RuntimeAction,
} from "@/lib/action-runtime";
import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";
import {
  processChannelFlowText,
  startChannelFlow,
} from "@/lib/channel-flow-runtime";
import {
  type ChannelType,
  getOrCreateChannelConversation,
  recordChannelInboundMessage,
  recordChannelOutboundMessage,
} from "@/lib/channels";
import {
  getRuntimeProjectAction,
  getRuntimeProjectActionForSubmission,
  listRuntimeProjectActions,
} from "@/lib/runtime-actions";

type RunBrowserFlowTextInput = {
  actionId?: number;
  channelType: ChannelType;
  conversationId: string;
  externalUserId?: string | null;
  projectId: number;
  source: string;
  text?: string;
};

function toActiveActionFlow(input: {
  action: RuntimeAction;
  conversationId: string;
  submission: NonNullable<
    Awaited<ReturnType<typeof getActiveActionSubmissionForConversation>>
  >;
}): ActiveActionFlow {
  const steps = getRunnableActionSteps(input.action);
  const stepIndex =
    input.submission.currentStepId === null
      ? steps.length
      : steps.findIndex((step) => step.id === input.submission.currentStepId);
  const currentStep = stepIndex >= 0 ? steps[stepIndex] : null;

  return {
    actionId: input.action.id,
    actionName: input.action.name,
    conversationId: input.conversationId,
    fields: input.submission.fields,
    mode:
      input.submission.currentStepId === null ||
      (currentStep && isActionConfirmationStep(currentStep))
        ? "confirming"
        : "collecting",
    stepIndex: stepIndex >= 0 ? stepIndex : steps.length,
    submissionId: input.submission.id,
  };
}

async function getBrowserFlowState(input: {
  conversationId: string;
  projectId: number;
  source: string;
}) {
  const submission = await getActiveActionSubmissionForConversation(input);

  if (!submission) {
    return { action: null, activeFlow: null };
  }

  const action = await getRuntimeProjectActionForSubmission(
    input.projectId,
    submission,
  );

  if (!action) {
    return { action: null, activeFlow: null };
  }

  return {
    action,
    activeFlow: toActiveActionFlow({
      action,
      conversationId: input.conversationId,
      submission,
    }),
  };
}

export async function runBrowserFlowText(
  input: RunBrowserFlowTextInput,
): Promise<BrowserFlowRuntimeResult> {
  const activeSubmission = await getActiveActionSubmissionForConversation({
    conversationId: input.conversationId,
    projectId: input.projectId,
    source: input.source,
  });
  const text = input.text?.trim() ?? "";
  let action: RuntimeAction | null = null;

  if (!activeSubmission) {
    if (input.actionId) {
      action = await getRuntimeProjectAction(input.projectId, input.actionId);
    } else if (text) {
      action = findTriggeredAction(
        await listRuntimeProjectActions(input.projectId),
        text,
      );
    }

    if (!action) {
      return { action: null, activeFlow: null, handled: false, replies: [] };
    }
  }

  const inboundRecord = text
    ? await recordChannelInboundMessage({
        channelType: input.channelType,
        externalConversationId: input.conversationId,
        externalUserId: input.externalUserId,
        projectId: input.projectId,
        text,
      })
    : {
        conversation: await getOrCreateChannelConversation({
          channelType: input.channelType,
          externalConversationId: input.conversationId,
          externalUserId: input.externalUserId,
          projectId: input.projectId,
        }),
      };
  const result = activeSubmission
    ? await processChannelFlowText({
        activeSubmission,
        contactId: inboundRecord.conversation.contactId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        source: input.source,
        text,
      })
    : action
      ? await startChannelFlow({
          action,
          contactId: inboundRecord.conversation.contactId,
          conversationId: input.conversationId,
          projectId: input.projectId,
          source: input.source,
        })
      : { replies: [] };

  for (const reply of result.replies) {
    await recordChannelOutboundMessage({
      channelType: input.channelType,
      externalConversationId: input.conversationId,
      messageType: reply.type,
      payload: reply.payload,
      projectId: input.projectId,
      text: reply.fallbackText,
    });
  }

  const state = await getBrowserFlowState({
    conversationId: input.conversationId,
    projectId: input.projectId,
    source: input.source,
  });

  return {
    ...state,
    handled: true,
    replies: result.replies,
  };
}
