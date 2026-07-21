import { createHash } from "node:crypto";
import { ActionSubmissionConflictError } from "@/lib/action-flow-submissions";
import {
  getActionSubmission,
  getActiveActionSubmissionForConversation,
} from "@/lib/action-flows";
import type { ActiveActionFlow } from "@/lib/action-runtime";
import {
  type FlowEditSection,
  findTriggeredAction,
  getRunnableActionSteps,
  isActionConfirmationStep,
  type RuntimeAction,
} from "@/lib/action-runtime";
import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";
import {
  buildChannelFlowResumeReplies,
  processChannelFlowMedia,
  processChannelFlowText,
  startChannelFlow,
  startChannelFlowEdit,
} from "@/lib/channel-flow-runtime";
import {
  type ChannelType,
  getOrCreateChannelConversation,
  recordChannelInboundMessage,
  recordChannelOutboundMessage,
} from "@/lib/channels";
import type { FlowMediaUploadValue } from "@/lib/flow-media-values";
import {
  claimFlowRuntimeCommand,
  completeFlowRuntimeCommand,
  failFlowRuntimeCommand,
} from "@/lib/flow-runtime-commands";
import {
  getRuntimeProjectAction,
  getRuntimeProjectActionForSubmission,
  listRuntimeProjectActions,
} from "@/lib/runtime-actions";

type RunBrowserFlowTextInput = {
  actionId?: number;
  channelType: ChannelType;
  commandId?: string;
  conversationId: string;
  externalUserId?: string | null;
  editSection?: FlowEditSection;
  expectedRevision?: number;
  projectId: number;
  resume?: boolean;
  source: string;
  text?: string;
};

export class BrowserFlowCommandError extends Error {
  constructor(
    message: string,
    public readonly code: "conflict" | "failed" | "processing" | "stale",
  ) {
    super(message);
    this.name = "BrowserFlowCommandError";
  }
}

type RunBrowserFlowMediaInput = {
  channelType: ChannelType;
  media: FlowMediaUploadValue;
  projectId: number;
  source: string;
  submissionId: number;
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
    revision: input.submission.revision,
    stepIndex: stepIndex >= 0 ? stepIndex : steps.length,
    submissionId: input.submission.id,
  };
}

async function recordBrowserFlowReplies(input: {
  channelType: ChannelType;
  conversationId: string;
  projectId: number;
  replies: BrowserFlowRuntimeResult["replies"];
}) {
  for (const reply of input.replies) {
    await recordChannelOutboundMessage({
      channelType: input.channelType,
      externalConversationId: input.conversationId,
      messageType: reply.type,
      payload: reply.payload,
      projectId: input.projectId,
      text: reply.fallbackText,
    });
  }
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

async function executeBrowserFlowText(
  input: RunBrowserFlowTextInput,
): Promise<BrowserFlowRuntimeResult> {
  const activeSubmission = await getActiveActionSubmissionForConversation({
    conversationId: input.conversationId,
    projectId: input.projectId,
    source: input.source,
  });
  const text = input.text?.trim() ?? "";
  let action: RuntimeAction | null = null;

  if (
    activeSubmission &&
    input.expectedRevision !== undefined &&
    activeSubmission.revision !== input.expectedRevision
  ) {
    throw new ActionSubmissionConflictError();
  }

  if (input.resume) {
    if (!activeSubmission) {
      return { action: null, activeFlow: null, handled: false, replies: [] };
    }

    action = await getRuntimeProjectActionForSubmission(
      input.projectId,
      activeSubmission,
    );
    if (!action) {
      return { action: null, activeFlow: null, handled: false, replies: [] };
    }

    return {
      action,
      activeFlow: toActiveActionFlow({
        action,
        conversationId: input.conversationId,
        submission: activeSubmission,
      }),
      handled: true,
      replies: buildChannelFlowResumeReplies({
        action,
        submission: activeSubmission,
      }),
    };
  }

  if (input.editSection) {
    if (!activeSubmission) {
      return { action: null, activeFlow: null, handled: true, replies: [] };
    }

    action = await getRuntimeProjectActionForSubmission(
      input.projectId,
      activeSubmission,
    );
    if (!action) {
      return { action: null, activeFlow: null, handled: true, replies: [] };
    }

    const conversation = await getOrCreateChannelConversation({
      channelType: input.channelType,
      externalConversationId: input.conversationId,
      externalUserId: input.externalUserId,
      projectId: input.projectId,
    });
    const editResult = await startChannelFlowEdit({
      action,
      contactId: conversation.contactId,
      projectId: input.projectId,
      section: input.editSection,
      submission: activeSubmission,
    });
    await recordBrowserFlowReplies({
      channelType: input.channelType,
      conversationId: input.conversationId,
      projectId: input.projectId,
      replies: editResult.replies,
    });
    const state = await getBrowserFlowState({
      conversationId: input.conversationId,
      projectId: input.projectId,
      source: input.source,
    });

    return { ...state, handled: true, replies: editResult.replies };
  }

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

  await recordBrowserFlowReplies({
    channelType: input.channelType,
    conversationId: input.conversationId,
    projectId: input.projectId,
    replies: result.replies,
  });

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

function hashBrowserFlowCommand(input: RunBrowserFlowTextInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actionId: input.actionId ?? null,
        editSection: input.editSection ?? null,
        expectedRevision: input.expectedRevision ?? null,
        text: input.text ?? null,
      }),
    )
    .digest("hex");
}

export async function runBrowserFlowText(
  input: RunBrowserFlowTextInput,
): Promise<BrowserFlowRuntimeResult> {
  if (!input.commandId || input.resume) {
    return executeBrowserFlowText(input);
  }

  const claim = await claimFlowRuntimeCommand({
    commandId: input.commandId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    requestHash: hashBrowserFlowCommand(input),
    source: input.source,
  });

  if (claim.state === "replay") {
    return claim.result;
  }

  if (claim.state !== "claimed") {
    const messages = {
      conflict: "This command ID was already used for another request.",
      failed: "The previous attempt for this command failed.",
      processing: "This command is already being processed.",
    } as const;
    throw new BrowserFlowCommandError(messages[claim.state], claim.state);
  }

  try {
    const result = await executeBrowserFlowText(input);
    await completeFlowRuntimeCommand({
      commandId: claim.commandId,
      projectId: input.projectId,
      result,
    });
    return result;
  } catch (error) {
    await failFlowRuntimeCommand({
      commandId: claim.commandId,
      errorMessage:
        error instanceof Error ? error.message : "Unknown runtime failure.",
      projectId: input.projectId,
    });
    if (error instanceof ActionSubmissionConflictError) {
      throw new BrowserFlowCommandError(
        "This flow changed in another request. Refresh and try again.",
        "stale",
      );
    }
    throw error;
  }
}

export async function runBrowserFlowMedia(
  input: RunBrowserFlowMediaInput,
): Promise<BrowserFlowRuntimeResult> {
  const submission = await getActionSubmission(
    input.projectId,
    input.submissionId,
  );

  if (
    !submission ||
    submission.status !== "in_progress" ||
    submission.source !== input.source ||
    !submission.conversationId
  ) {
    return { action: null, activeFlow: null, handled: true, replies: [] };
  }

  const result = await processChannelFlowMedia({
    activeSubmission: submission,
    media: input.media,
    projectId: input.projectId,
  });
  await recordBrowserFlowReplies({
    channelType: input.channelType,
    conversationId: submission.conversationId,
    projectId: input.projectId,
    replies: result.replies,
  });
  const state = await getBrowserFlowState({
    conversationId: submission.conversationId,
    projectId: input.projectId,
    source: input.source,
  });

  return { ...state, handled: true, replies: result.replies };
}
