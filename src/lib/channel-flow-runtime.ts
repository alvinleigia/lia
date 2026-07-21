import {
  ActionSubmissionConflictError,
  cancelActionFlowSubmission,
  recordActionFlowProgress,
  startActionFlowSubmission,
  submitActionFlowSubmission,
} from "@/lib/action-flow-submissions";
import {
  addActionSubmissionEvent,
  getActionSubmission,
  markActionSubmissionForReview,
} from "@/lib/action-flows";
import {
  buildActionReviewSummary,
  buildActionStepChannelMessage,
  buildActionStepTextFallbackMessage,
  buildInvalidStepAnswerMessage,
  buildStepAnswerResult,
  type FlowEditSection,
  findTriggeredAction,
  getActionStepChoiceDisplayMode,
  getActionStepConnectedActionId,
  getActionStepConnectFlowMode,
  getActionStepOptions,
  getActionStepProductCatalog,
  getActionStepProducts,
  getActionStepWhatsAppTemplate,
  getNextActionStepDecision,
  getRunnableActionSteps,
  isActionConfirmationStep,
  isActionConnectFlowStep,
  isActionInputStep,
  isActionMessageStep,
  isActionMutationStep,
  isActionSubmitStep,
  isInlineOperationStep,
  isProductMessageStep,
  normalizeActionText,
  prepareFlowSectionEdit,
  type RuntimeAction,
  type RuntimeActionStep,
  resolveTemplateVariableValue,
  validateStepAnswer,
} from "@/lib/action-runtime";
import {
  getChannelTypeForFlowSource,
  markChannelConversationForReview,
} from "@/lib/channels";
import { executeContactMutationStep } from "@/lib/contact-flow-mutations";
import { setContactAttribute } from "@/lib/contacts";
import type { SelectActionSubmission } from "@/lib/db-schema";
import {
  getFlowCatalogContentBlocks,
  getFlowMediaContentBlocks,
} from "@/lib/flow-content-blocks";
import {
  type FlowMediaUploadValue,
  formatFlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";
import { buildHandoffMetadata, runHandoffNotification } from "@/lib/handoff";
import { runOperationForSubmission } from "@/lib/operations";
import {
  getRuntimeProjectAction,
  getRuntimeProjectActionForSubmission,
  listRuntimeProjectActions,
} from "@/lib/runtime-actions";
import {
  createChoiceReply,
  createMediaReply,
  createProductReply,
  createTemplateReply,
  createTextReply,
  type RuntimeReply,
  type RuntimeReplyOption,
} from "@/lib/runtime-replies";

const CONFIRM_WORDS = new Set(["confirm", "yes", "y", "submit", "ok", "okay"]);
const CANCEL_WORDS = new Set(["cancel", "stop", "no", "exit"]);
const MAX_CONNECTED_FLOW_DEPTH = 5;
const FLOW_EDIT_POSITION_KEY = "flowEditPosition";
const FLOW_EDIT_STEP_IDS_KEY = "flowEditStepIds";

type ChannelRuntimeResult = {
  replies: RuntimeReply[];
};
type ReturnFlowFrame = {
  parentSubmissionId: number;
  returnToActionId: number;
  returnToStepId: number;
};

function getSubmissionContactId(submission: SelectActionSubmission) {
  const contactId = submission.metadata.contactId;
  return typeof contactId === "number" ? contactId : null;
}

function getFlowEditState(
  action: RuntimeAction,
  submission: SelectActionSubmission,
) {
  const stepIds = submission.metadata[FLOW_EDIT_STEP_IDS_KEY];
  const position = submission.metadata[FLOW_EDIT_POSITION_KEY];

  if (
    !Array.isArray(stepIds) ||
    !stepIds.every((stepId) => typeof stepId === "number") ||
    typeof position !== "number" ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= stepIds.length
  ) {
    return null;
  }

  const steps = getRunnableActionSteps(action);
  const stepIndexes = stepIds
    .map((stepId) => steps.findIndex((step) => step.id === stepId))
    .filter((stepIndex) => stepIndex >= 0);

  if (stepIndexes.length !== stepIds.length) {
    return null;
  }

  return { position, stepIds, stepIndexes };
}

function updateFlowEditMetadata(
  metadata: Record<string, unknown>,
  nextPosition: number | null,
) {
  const nextMetadata = { ...metadata };

  if (nextPosition === null) {
    delete nextMetadata[FLOW_EDIT_POSITION_KEY];
    delete nextMetadata[FLOW_EDIT_STEP_IDS_KEY];
  } else {
    nextMetadata[FLOW_EDIT_POSITION_KEY] = nextPosition;
  }

  return nextMetadata;
}

function getConnectedActionPath(submission: SelectActionSubmission) {
  const path = submission.metadata.connectedActionIds;

  if (!Array.isArray(path)) {
    return [submission.actionId];
  }

  const actionIds = path.filter(
    (actionId): actionId is number => typeof actionId === "number",
  );

  return actionIds.length > 0 ? actionIds : [submission.actionId];
}

function getConnectedFlowDepth(submission: SelectActionSubmission) {
  const depth = submission.metadata.connectedFlowDepth;
  return typeof depth === "number" ? depth : 0;
}

function getReturnFlowFrame(
  submission: SelectActionSubmission,
): ReturnFlowFrame | null {
  if (submission.metadata.connectedFlowMode !== "return") {
    return null;
  }

  const parentSubmissionId = submission.metadata.parentSubmissionId;
  const returnToActionId =
    submission.metadata.returnToActionId ??
    submission.metadata.connectedFromActionId;
  const returnToStepId =
    submission.metadata.returnToStepId ??
    submission.metadata.connectedFromStepId;

  if (
    typeof parentSubmissionId !== "number" ||
    typeof returnToActionId !== "number" ||
    typeof returnToStepId !== "number"
  ) {
    return null;
  }

  return {
    parentSubmissionId,
    returnToActionId,
    returnToStepId,
  };
}

function formatStepPrompt(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  return buildActionStepTextFallbackMessage(step, fields);
}

function buildRuntimeReplyForStep(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  const prompt = buildActionStepChannelMessage(step);
  const options = isActionInputStep(step)
    ? getActionStepOptions(step, fields)
    : [];

  if (step.stepType === "media" && step.settings.mediaAsset) {
    return createMediaReply({
      media: step.settings.mediaAsset,
      text: prompt,
    });
  }

  if (step.stepType === "template_message") {
    const template = getActionStepWhatsAppTemplate(step);

    if (template) {
      return createTemplateReply({
        template: {
          ...template,
          variables: template.variables.map((variable) =>
            resolveTemplateVariableValue(variable, fields),
          ),
        },
        text: prompt,
      });
    }
  }

  if (isProductMessageStep(step)) {
    return createProductReply({
      catalog: getActionStepProductCatalog(step),
      mode:
        step.stepType === "single_product"
          ? "single_product"
          : step.stepType === "multiple_products"
            ? "multiple_products"
            : "catalog",
      products: getActionStepProducts(step),
      text: prompt,
    });
  }

  if (!isActionInputStep(step) || options.length === 0) {
    return createTextReply(prompt);
  }

  const replyOptions: RuntimeReplyOption[] = options.map((option, index) => ({
    description: option.description,
    id: `${step.id}-${index + 1}`,
    label: option.label,
    value: String(option.value),
  }));

  return createChoiceReply({
    displayMode: getActionStepChoiceDisplayMode(step),
    options: replyOptions,
    text: prompt,
  });
}

function buildRuntimeRepliesForStep(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  const primaryReply = buildRuntimeReplyForStep(step, fields);
  const contentReplies: RuntimeReply[] = [];

  for (const block of getFlowMediaContentBlocks(step.settings)) {
    if (block.media) {
      contentReplies.push(
        createMediaReply({ media: block.media, text: block.text }),
      );
    }
  }

  for (const block of getFlowCatalogContentBlocks(step.settings)) {
    if (block.products.length > 0) {
      contentReplies.push(
        createProductReply({
          catalog: block.catalog,
          mode: block.displayMode,
          products: block.products,
          text: block.text || "View products",
        }),
      );
    }
  }

  return isActionInputStep(step) &&
    getActionStepOptions(step, fields).length > 0
    ? [...contentReplies, primaryReply]
    : [primaryReply, ...contentReplies];
}

export function buildChannelFlowResumeReplies(input: {
  action: RuntimeAction;
  submission: SelectActionSubmission;
}): RuntimeReply[] {
  const steps = getRunnableActionSteps(input.action);
  const currentStep =
    input.submission.currentStepId === null
      ? null
      : steps.find((step) => step.id === input.submission.currentStepId);

  if (currentStep && isActionConfirmationStep(currentStep)) {
    return [
      createTextReply(
        [
          formatStepPrompt(currentStep, input.submission.fields),
          "",
          buildActionReviewSummary(input.submission.fields),
          "",
          "Reply Confirm to save, or Cancel to stop.",
        ].join("\n"),
      ),
    ];
  }

  if (currentStep) {
    return buildRuntimeRepliesForStep(currentStep, input.submission.fields);
  }

  return [
    createTextReply(
      [
        "Please review your request before I save it.",
        "",
        buildActionReviewSummary(input.submission.fields),
        "",
        "Reply Confirm to save, or Cancel to stop.",
      ].join("\n"),
    ),
  ];
}

async function submitFlow(input: {
  contactId?: number | null;
  projectId: number;
  submission: SelectActionSubmission;
}) {
  const submission = await submitActionFlowSubmission({
    projectId: input.projectId,
    submissionId: input.submission.id,
    fields: input.submission.fields,
    expectedRevision: input.submission.revision,
  });

  if (!submission) {
    return {
      replies: [
        createTextReply("I could not save that request. Please try again."),
      ],
    };
  }

  const returnedResult = await resumeParentFlowAfterSubmit({
    childSubmission: submission,
    contactId: input.contactId ?? getSubmissionContactId(submission),
    projectId: input.projectId,
  });

  if (returnedResult) {
    return returnedResult;
  }

  return {
    replies: [
      createTextReply(
        [
          "Thanks. I saved this request.",
          "",
          buildActionReviewSummary(submission.fields),
        ].join("\n"),
      ),
    ],
  };
}

async function cancelParentReturnFlow(input: {
  projectId: number;
  submission: SelectActionSubmission;
}) {
  const frame = getReturnFlowFrame(input.submission);

  if (!frame) {
    return;
  }

  const parentSubmission = await getActionSubmission(
    input.projectId,
    frame.parentSubmissionId,
  );

  if (!parentSubmission || parentSubmission.status !== "in_progress") {
    return;
  }

  await cancelActionFlowSubmission({
    projectId: input.projectId,
    submissionId: parentSubmission.id,
    expectedRevision: parentSubmission.revision,
  });

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.submission.id,
    eventType: "flow.parent_cancelled",
    message: "Parent flow was cancelled with the connected subflow.",
    payload: {
      parentSubmissionId: parentSubmission.id,
      returnToActionId: frame.returnToActionId,
      returnToStepId: frame.returnToStepId,
    },
  });
}

async function resumeParentFlowAfterSubmit(input: {
  childSubmission: SelectActionSubmission;
  contactId?: number | null;
  projectId: number;
}): Promise<ChannelRuntimeResult | null> {
  const frame = getReturnFlowFrame(input.childSubmission);

  if (!frame) {
    return null;
  }

  const parentSubmission = await getActionSubmission(
    input.projectId,
    frame.parentSubmissionId,
  );
  const parentAction = parentSubmission
    ? await getRuntimeProjectActionForSubmission(
        input.projectId,
        parentSubmission,
      )
    : null;

  if (
    !parentSubmission ||
    parentSubmission.status !== "in_progress" ||
    !parentAction
  ) {
    return {
      replies: [
        createTextReply(
          "The connected flow finished, but I could not resume the original flow. Please start again.",
        ),
      ],
    };
  }

  const steps = getRunnableActionSteps(parentAction);
  const returnStepIndex = findStepIndexById(parentAction, frame.returnToStepId);
  const returnStep = steps[returnStepIndex];

  if (!returnStep) {
    return {
      replies: [
        createTextReply(
          "The connected flow finished, but its return step is no longer available. Please ask the team to review the setup.",
        ),
      ],
    };
  }

  const fields = {
    ...parentSubmission.fields,
    ...input.childSubmission.fields,
  };
  const branchDecision = getNextActionStepDecision(
    parentAction,
    returnStep,
    returnStepIndex,
    fields,
  );
  const nextStep =
    branchDecision.stepIndex === null ? null : steps[branchDecision.stepIndex];
  const updatedParentSubmission = await recordActionFlowProgress({
    projectId: input.projectId,
    submissionId: parentSubmission.id,
    currentStepId: nextStep?.id ?? null,
    fields,
    expectedRevision: parentSubmission.revision,
    event: {
      eventType: "flow.returned",
      message: `Returned from connected flow ${input.childSubmission.metadata.actionName ?? input.childSubmission.actionId}.`,
      payload: {
        branchDecision,
        childActionId: input.childSubmission.actionId,
        childSubmissionId: input.childSubmission.id,
        returnToActionId: frame.returnToActionId,
        returnToStepId: frame.returnToStepId,
      },
    },
  });

  if (!updatedParentSubmission) {
    return {
      replies: [
        createTextReply(
          "The connected flow finished, but I could not update the original flow. Please try again.",
        ),
      ],
    };
  }

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.childSubmission.id,
    eventType: "flow.returned",
    message: `Returned to ${parentAction.name}.`,
    payload: {
      parentActionId: parentAction.id,
      parentSubmissionId: parentSubmission.id,
      returnToStepId: frame.returnToStepId,
    },
  });

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: updatedParentSubmission.id,
    eventType: "flow.branch_decision",
    message: "Flow route selected after connected flow returned.",
    payload: branchDecision,
  });

  return advanceFlowToNextStep({
    action: parentAction,
    contactId:
      input.contactId ?? getSubmissionContactId(updatedParentSubmission),
    projectId: input.projectId,
    submission: updatedParentSubmission,
    stepIndex: branchDecision.stepIndex ?? steps.length,
  });
}

async function requestHumanHandoff(input: {
  action: RuntimeAction;
  projectId: number;
  step: RuntimeActionStep;
  submission: SelectActionSubmission;
}) {
  const handoff = buildHandoffMetadata(input);
  const submission = await markActionSubmissionForReview({
    currentStepId: input.step.id,
    fields: input.submission.fields,
    handoff,
    expectedRevision: input.submission.revision,
    projectId: input.projectId,
    submissionId: input.submission.id,
  });

  if (!submission) {
    throw new ActionSubmissionConflictError();
  }

  await addActionSubmissionEvent({
    eventType: "flow.handoff_requested",
    message: "Human handoff requested.",
    payload: handoff,
    projectId: input.projectId,
    submissionId: input.submission.id,
  });

  if (input.submission.conversationId) {
    await markChannelConversationForReview({
      channelType: getChannelTypeForFlowSource(input.submission.source),
      externalConversationId: input.submission.conversationId,
      handoff: {
        ...handoff,
        submissionId: input.submission.id,
      },
      projectId: input.projectId,
    });
  }

  await runHandoffNotification({
    action: input.action,
    fields: input.submission.fields,
    handoff,
    projectId: input.projectId,
    step: input.step,
    submissionId: input.submission.id,
  });

  return submission;
}

async function connectFlow(input: {
  action: RuntimeAction;
  contactId?: number | null;
  projectId: number;
  step: RuntimeActionStep;
  submission: SelectActionSubmission;
}): Promise<ChannelRuntimeResult> {
  const targetActionId = getActionStepConnectedActionId(input.step);
  const mode = getActionStepConnectFlowMode(input.step);

  if (!targetActionId) {
    await cancelActionFlowSubmission({
      projectId: input.projectId,
      submissionId: input.submission.id,
      expectedRevision: input.submission.revision,
    });

    return {
      replies: [
        createTextReply(
          "This flow is missing a connected flow target. Please ask the team to review the setup.",
        ),
      ],
    };
  }

  const connectedActionPath = getConnectedActionPath(input.submission);
  const depth = getConnectedFlowDepth(input.submission);

  if (
    targetActionId === input.action.id ||
    connectedActionPath.includes(targetActionId) ||
    depth >= MAX_CONNECTED_FLOW_DEPTH
  ) {
    await cancelActionFlowSubmission({
      projectId: input.projectId,
      submissionId: input.submission.id,
      expectedRevision: input.submission.revision,
    });

    return {
      replies: [
        createTextReply(
          "This flow has a connected-flow loop. Please ask the team to review the action setup.",
        ),
      ],
    };
  }

  const targetAction = await getRuntimeProjectAction(
    input.projectId,
    targetActionId,
  );

  if (!targetAction) {
    await cancelActionFlowSubmission({
      projectId: input.projectId,
      submissionId: input.submission.id,
      expectedRevision: input.submission.revision,
    });

    return {
      replies: [
        createTextReply(
          "The connected flow is not available right now. Please ask the team to review the setup.",
        ),
      ],
    };
  }

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.submission.id,
    eventType: "flow.connected",
    message: `Connected to ${targetAction.name}.`,
    payload: {
      connectFlowMode: mode,
      sourceActionId: input.action.id,
      sourceStepId: input.step.id,
      targetActionId,
      targetActionName: targetAction.name,
    },
  });

  if (mode === "jump") {
    await cancelActionFlowSubmission({
      projectId: input.projectId,
      submissionId: input.submission.id,
      expectedRevision: input.submission.revision,
    });
  }

  const nextSubmission = await startActionFlowSubmission({
    actionId: targetAction.id,
    actionVersionId: targetAction.versionId,
    contactId: input.contactId ?? getSubmissionContactId(input.submission),
    conversationId: input.submission.conversationId,
    fields: input.submission.fields,
    metadata: {
      connectedActionIds: [...connectedActionPath, targetAction.id],
      connectedFlowMode: mode,
      connectedFlowDepth: depth + 1,
      connectedFromActionId: input.action.id,
      connectedFromStepId: input.step.id,
      parentSubmissionId: input.submission.id,
      returnToActionId: mode === "return" ? input.action.id : undefined,
      returnToStepId: mode === "return" ? input.step.id : undefined,
    },
    projectId: input.projectId,
    source: input.submission.source,
    traceId: input.submission.traceId,
  });

  if (!nextSubmission) {
    return {
      replies: [
        createTextReply(
          "I could not start the connected flow. Please try again.",
        ),
      ],
    };
  }

  const nextResult = await advanceFlowToNextStep({
    action: targetAction,
    contactId: input.contactId ?? getSubmissionContactId(input.submission),
    projectId: input.projectId,
    submission: nextSubmission,
    stepIndex: 0,
  });

  return {
    replies: [
      ...buildRuntimeRepliesForStep(input.step, input.submission.fields),
      ...nextResult.replies,
    ],
  };
}

async function advanceFlowToNextStep(input: {
  action: RuntimeAction;
  contactId?: number | null;
  projectId: number;
  submission: SelectActionSubmission;
  stepIndex: number;
}): Promise<ChannelRuntimeResult> {
  const steps = getRunnableActionSteps(input.action);
  const replies: RuntimeReply[] = [];
  let stepIndex = input.stepIndex;
  const visitedStepIds = new Set<number>();
  let submission = input.submission;

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    if (visitedStepIds.has(step.id)) {
      await cancelActionFlowSubmission({
        projectId: input.projectId,
        submissionId: submission.id,
        expectedRevision: submission.revision,
      });

      return {
        replies: [
          createTextReply(
            "This flow has a routing loop. Please ask the team to review the action setup.",
          ),
        ],
      };
    }

    visitedStepIds.add(step.id);

    if (step.stepType === "handoff") {
      replies.push(...buildRuntimeRepliesForStep(step, submission.fields));
      await requestHumanHandoff({
        action: input.action,
        projectId: input.projectId,
        step,
        submission,
      });
      return { replies };
    }

    if (isActionConnectFlowStep(step)) {
      const result = await connectFlow({
        action: input.action,
        contactId: input.contactId ?? getSubmissionContactId(submission),
        projectId: input.projectId,
        step,
        submission,
      });
      return { replies: [...replies, ...result.replies] };
    }

    if (isActionMessageStep(step)) {
      replies.push(...buildRuntimeRepliesForStep(step, submission.fields));
      const decision = getNextActionStepDecision(
        input.action,
        step,
        stepIndex,
        submission.fields,
      );

      if (decision.stepIndex === null) {
        break;
      }

      stepIndex = decision.stepIndex;
      continue;
    }

    if (isActionMutationStep(step)) {
      await executeContactMutationStep({
        contactId: input.contactId ?? getSubmissionContactId(submission),
        fields: submission.fields,
        projectId: input.projectId,
        source: submission.source,
        step,
        submissionId: submission.id,
      });
      const decision = getNextActionStepDecision(
        input.action,
        step,
        stepIndex,
        submission.fields,
      );

      if (decision.stepIndex === null) {
        break;
      }

      stepIndex = decision.stepIndex;
      continue;
    }

    if (isInlineOperationStep(step)) {
      const operationStatusFieldKey =
        step.fieldKey?.trim() || `operation_${step.id}_status`;
      const operationResult =
        step.operationId === null
          ? null
          : await runOperationForSubmission({
              actionId: input.action.id,
              fields: submission.fields,
              idempotencyKey: `submission:${submission.id}:step:${step.id}:revision:${submission.revision}`,
              operationId: step.operationId,
              projectId: input.projectId,
              submissionId: submission.id,
              traceId: submission.traceId,
            });
      const operationStatus = operationResult?.attempt.status ?? "failed";
      const nextFields = {
        ...submission.fields,
        ...(operationResult?.fields ?? {}),
        [operationStatusFieldKey]: operationStatus,
      };
      const contactId =
        input.contactId ?? getSubmissionContactId(submission) ?? null;
      const mappedContactAttributes = operationResult?.contactAttributes ?? {};

      if (contactId) {
        for (const [key, value] of Object.entries(mappedContactAttributes)) {
          await setContactAttribute({
            contactId,
            key,
            projectId: input.projectId,
            source: submission.source,
            value,
          });
        }
      }

      const updatedSubmission = await recordActionFlowProgress({
        projectId: input.projectId,
        submissionId: submission.id,
        currentStepId: step.id,
        fields: nextFields,
        expectedRevision: submission.revision,
        event: {
          eventType: "flow.operation_result",
          message: "Inline operation completed.",
          payload: {
            attemptId: operationResult?.attempt.id ?? null,
            contactAttributeKeys: Object.keys(mappedContactAttributes),
            fieldKey: operationStatusFieldKey,
            mappedFieldKeys: Object.keys(operationResult?.fields ?? {}),
            operationId: step.operationId,
            status: operationStatus,
            stepId: step.id,
          },
        },
      });
      submission = updatedSubmission ?? submission;
      const decision = getNextActionStepDecision(
        input.action,
        step,
        stepIndex,
        submission.fields,
      );

      await addActionSubmissionEvent({
        projectId: input.projectId,
        submissionId: submission.id,
        eventType: "flow.branch_decision",
        message: "Flow route selected.",
        payload: decision,
      });

      if (decision.stepIndex === null) {
        break;
      }

      stepIndex = decision.stepIndex;
      continue;
    }

    if (isActionSubmitStep(step)) {
      replies.push(...buildRuntimeRepliesForStep(step, submission.fields));
      const result = await submitFlow({
        contactId: input.contactId ?? getSubmissionContactId(submission),
        projectId: input.projectId,
        submission,
      });
      return { replies: [...replies, ...result.replies] };
    }

    if (isActionConfirmationStep(step)) {
      const updatedSubmission = await recordActionFlowProgress({
        projectId: input.projectId,
        submissionId: submission.id,
        currentStepId: step.id,
        fields: submission.fields,
        expectedRevision: submission.revision,
      });
      submission = updatedSubmission ?? submission;
      replies.push(
        createTextReply(
          [
            formatStepPrompt(step, submission.fields),
            "",
            buildActionReviewSummary(submission.fields),
            "",
            "Reply Confirm to save, or Cancel to stop.",
          ].join("\n"),
        ),
      );
      return { replies };
    }

    if (isActionInputStep(step)) {
      const updatedSubmission = await recordActionFlowProgress({
        projectId: input.projectId,
        submissionId: submission.id,
        currentStepId: step.id,
        fields: submission.fields,
        expectedRevision: submission.revision,
      });
      submission = updatedSubmission ?? submission;
      replies.push(...buildRuntimeRepliesForStep(step, submission.fields));
      return { replies };
    }

    stepIndex += 1;
  }

  const updatedSubmission = await recordActionFlowProgress({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: null,
    fields: submission.fields,
    expectedRevision: submission.revision,
  });
  submission = updatedSubmission ?? submission;

  return {
    replies: [
      ...replies,
      createTextReply(
        [
          "Please review your request before I save it.",
          "",
          buildActionReviewSummary(submission.fields),
          "",
          "Reply Confirm to save, or Cancel to stop.",
        ].join("\n"),
      ),
    ],
  };
}

export function resumeChannelFlowExecution(input: {
  action: RuntimeAction;
  contactId?: number | null;
  projectId: number;
  submission: SelectActionSubmission;
}) {
  const steps = getRunnableActionSteps(input.action);
  const stepIndex =
    input.submission.currentStepId === null
      ? steps.length
      : steps.findIndex((step) => step.id === input.submission.currentStepId);

  if (stepIndex < 0) {
    return {
      replies: [
        createTextReply(
          "This flow can no longer find its saved resume point. Please start again.",
        ),
      ],
    };
  }

  return advanceFlowToNextStep({
    action: input.action,
    contactId: input.contactId,
    projectId: input.projectId,
    stepIndex,
    submission: input.submission,
  });
}

function findStepIndexById(action: RuntimeAction, stepId: number | null) {
  if (stepId === null) {
    return getRunnableActionSteps(action).length;
  }

  return getRunnableActionSteps(action).findIndex((step) => step.id === stepId);
}

export async function startChannelFlow(input: {
  action: RuntimeAction;
  contactId?: number | null;
  conversationId: string;
  projectId: number;
  source: string;
  traceId?: string | null;
}) {
  const steps = getRunnableActionSteps(input.action);

  if (steps.length === 0) {
    return {
      replies: [
        createTextReply(
          `${input.action.name} is available, but it does not have any flow steps configured yet.`,
        ),
      ],
    };
  }

  const submission = await startActionFlowSubmission({
    projectId: input.projectId,
    actionId: input.action.id,
    actionVersionId: input.action.versionId,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId,
    source: input.source,
    traceId: input.traceId,
  });

  if (!submission) {
    return {
      replies: [
        createTextReply("I could not start that request. Please try again."),
      ],
    };
  }

  const result = await advanceFlowToNextStep({
    action: input.action,
    contactId: input.contactId ?? null,
    projectId: input.projectId,
    submission,
    stepIndex: 0,
  });

  return {
    replies: [
      createTextReply(`Sure, I can help with ${input.action.name}.`),
      ...result.replies,
    ],
  };
}

export async function startChannelFlowEdit(input: {
  action: RuntimeAction;
  contactId?: number | null;
  projectId: number;
  section: FlowEditSection;
  submission: SelectActionSubmission;
}) {
  const steps = getRunnableActionSteps(input.action);
  const currentStep = steps.find(
    (step) => step.id === input.submission.currentStepId,
  );

  if (
    input.submission.currentStepId !== null &&
    (!currentStep || !isActionConfirmationStep(currentStep))
  ) {
    return {
      replies: [
        createTextReply(
          "Finish the current question before editing the review details.",
        ),
      ],
    };
  }

  const editFlow = prepareFlowSectionEdit(
    input.action,
    {
      actionId: input.action.id,
      actionName: input.action.name,
      fields: input.submission.fields,
      mode: "confirming",
      revision: input.submission.revision,
      stepIndex: getRunnableActionSteps(input.action).length,
      submissionId: input.submission.id,
    },
    input.section,
  );
  const editStepIndexes = editFlow.editStepIndexes ?? [];
  const editStepIds = editStepIndexes
    .map((stepIndex) => steps[stepIndex]?.id)
    .filter((stepId): stepId is number => typeof stepId === "number");

  if (editStepIds.length === 0) {
    return {
      replies: [
        createTextReply("This request does not have those details to edit."),
      ],
    };
  }

  const metadata = {
    ...input.submission.metadata,
    [FLOW_EDIT_POSITION_KEY]: 0,
    [FLOW_EDIT_STEP_IDS_KEY]: editStepIds,
  };
  const updatedSubmission = await recordActionFlowProgress({
    projectId: input.projectId,
    submissionId: input.submission.id,
    currentStepId: editStepIds[0],
    fields: editFlow.fields,
    expectedRevision: input.submission.revision,
    metadata,
    event: {
      eventType: "flow.edit_started",
      message: `Started editing ${input.section} details.`,
      payload: { section: input.section, stepIds: editStepIds },
    },
  });

  if (!updatedSubmission) {
    return {
      replies: [
        createTextReply("I could not start editing. Please try again."),
      ],
    };
  }

  const result = await advanceFlowToNextStep({
    action: input.action,
    contactId: input.contactId ?? getSubmissionContactId(updatedSubmission),
    projectId: input.projectId,
    submission: updatedSubmission,
    stepIndex: editStepIndexes[0],
  });

  return {
    replies: [
      createTextReply("No problem. Let's update that."),
      ...result.replies,
    ],
  };
}

async function continueChannelFlow(input: {
  action: RuntimeAction;
  answer: string;
  contactId?: number | null;
  projectId: number;
  submission: SelectActionSubmission;
}) {
  const normalizedAnswer = normalizeActionText(input.answer);

  if (
    input.submission.currentStepId === null ||
    getRunnableActionSteps(input.action).some(
      (step) =>
        step.id === input.submission.currentStepId &&
        isActionConfirmationStep(step),
    )
  ) {
    if (CONFIRM_WORDS.has(normalizedAnswer)) {
      return submitFlow({
        contactId: input.contactId ?? getSubmissionContactId(input.submission),
        projectId: input.projectId,
        submission: input.submission,
      });
    }

    if (CANCEL_WORDS.has(normalizedAnswer)) {
      await cancelActionFlowSubmission({
        projectId: input.projectId,
        submissionId: input.submission.id,
        expectedRevision: input.submission.revision,
      });
      await cancelParentReturnFlow({
        projectId: input.projectId,
        submission: input.submission,
      });
      return {
        replies: [createTextReply("No problem. I cancelled this request.")],
      };
    }

    return {
      replies: [
        createTextReply("Please reply Confirm to save, or Cancel to stop."),
      ],
    };
  }

  const steps = getRunnableActionSteps(input.action);
  const stepIndex = findStepIndexById(
    input.action,
    input.submission.currentStepId,
  );
  const step = steps[stepIndex];

  if (!step) {
    return submitFlow({
      contactId: input.contactId ?? getSubmissionContactId(input.submission),
      projectId: input.projectId,
      submission: input.submission,
    });
  }

  if (!isActionInputStep(step)) {
    return advanceFlowToNextStep({
      action: input.action,
      contactId: input.contactId ?? getSubmissionContactId(input.submission),
      projectId: input.projectId,
      submission: input.submission,
      stepIndex,
    });
  }

  const parsedAnswer = validateStepAnswer(
    step,
    input.answer,
    input.submission.fields,
  );

  if (!parsedAnswer.isValid) {
    const fieldKey = step.fieldKey ?? `step_${step.id}`;
    const invalidMessage = buildInvalidStepAnswerMessage(
      step,
      input.submission.fields,
      input.answer,
    );

    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submission.id,
      eventType: "flow.validation_failed",
      message: invalidMessage,
      payload: {
        fieldKey,
        stepId: step.id,
        value: input.answer,
      },
    });

    return {
      replies: [
        createTextReply(
          `${invalidMessage}\n\n${formatStepPrompt(
            step,
            input.submission.fields,
          )}`,
        ),
      ],
    };
  }

  const fieldKey = step.fieldKey ?? `step_${step.id}`;
  const answerResult = buildStepAnswerResult(
    step,
    fieldKey,
    parsedAnswer.value,
    input.submission.fields,
  );
  const nextFields = {
    ...input.submission.fields,
    ...answerResult.fields,
  };
  const editState = getFlowEditState(input.action, input.submission);
  const nextEditPosition = editState ? editState.position + 1 : 0;
  const nextEditStepIndex =
    editState && nextEditPosition < editState.stepIndexes.length
      ? editState.stepIndexes[nextEditPosition]
      : null;
  const branchDecision = editState
    ? null
    : getNextActionStepDecision(input.action, step, stepIndex, nextFields);
  const nextStepIndex = editState
    ? nextEditStepIndex
    : (branchDecision?.stepIndex ?? null);
  const nextStep = nextStepIndex === null ? null : steps[nextStepIndex];
  const updatedSubmission = await recordActionFlowProgress({
    projectId: input.projectId,
    submissionId: input.submission.id,
    currentStepId: nextStep?.id ?? null,
    fields: nextFields,
    expectedRevision: input.submission.revision,
    metadata: editState
      ? updateFlowEditMetadata(
          input.submission.metadata,
          nextEditStepIndex === null ? null : nextEditPosition,
        )
      : input.submission.metadata,
    event: {
      eventType: "field.collected",
      message: fieldKey ? `Collected ${fieldKey}.` : "Collected flow field.",
      payload: {
        fieldKey,
        stepId: step.id,
        value: parsedAnswer.value,
      },
    },
  });

  if (!updatedSubmission) {
    return {
      replies: [
        createTextReply("I could not save that answer. Please try again."),
      ],
    };
  }

  if (branchDecision) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: updatedSubmission.id,
      eventType: "flow.branch_decision",
      message: "Flow route selected.",
      payload: branchDecision,
    });
  }

  return advanceFlowToNextStep({
    action: input.action,
    contactId: input.contactId ?? getSubmissionContactId(updatedSubmission),
    projectId: input.projectId,
    submission: updatedSubmission,
    stepIndex: nextStepIndex ?? steps.length,
  });
}

async function continueChannelFlowMedia(input: {
  action: RuntimeAction;
  media: FlowMediaUploadValue;
  contactId?: number | null;
  projectId: number;
  submission: SelectActionSubmission;
}) {
  if (
    input.submission.currentStepId === null ||
    getRunnableActionSteps(input.action).some(
      (step) =>
        step.id === input.submission.currentStepId &&
        isActionConfirmationStep(step),
    )
  ) {
    return {
      replies: [
        createTextReply("Please reply Confirm to save, or Cancel to stop."),
      ],
    };
  }

  const steps = getRunnableActionSteps(input.action);
  const stepIndex = findStepIndexById(
    input.action,
    input.submission.currentStepId,
  );
  const step = steps[stepIndex];

  if (!step) {
    return submitFlow({
      contactId: input.contactId ?? getSubmissionContactId(input.submission),
      projectId: input.projectId,
      submission: input.submission,
    });
  }

  if (!isActionInputStep(step)) {
    return advanceFlowToNextStep({
      action: input.action,
      contactId: input.contactId ?? getSubmissionContactId(input.submission),
      projectId: input.projectId,
      submission: input.submission,
      stepIndex,
    });
  }

  if (step.stepType !== "file_upload" || !isFlowMediaUploadValue(input.media)) {
    const fieldKey = step.fieldKey ?? `step_${step.id}`;
    const invalidMessage =
      step.stepType === "file_upload"
        ? buildInvalidStepAnswerMessage(step, input.submission.fields)
        : "This step is waiting for a text answer, not media.";

    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: input.submission.id,
      eventType: "flow.validation_failed",
      message: invalidMessage,
      payload: {
        fieldKey,
        stepId: step.id,
        value: input.media,
      },
    });

    return {
      replies: [
        createTextReply(
          `${invalidMessage}\n\n${formatStepPrompt(
            step,
            input.submission.fields,
          )}`,
        ),
      ],
    };
  }

  const fieldKey = step.fieldKey ?? `step_${step.id}`;
  const answerResult = buildStepAnswerResult(
    step,
    fieldKey,
    input.media,
    input.submission.fields,
  );
  const nextFields = {
    ...input.submission.fields,
    ...answerResult.fields,
  };
  const editState = getFlowEditState(input.action, input.submission);
  const nextEditPosition = editState ? editState.position + 1 : 0;
  const nextEditStepIndex =
    editState && nextEditPosition < editState.stepIndexes.length
      ? editState.stepIndexes[nextEditPosition]
      : null;
  const branchDecision = editState
    ? null
    : getNextActionStepDecision(input.action, step, stepIndex, nextFields);
  const nextStepIndex = editState
    ? nextEditStepIndex
    : (branchDecision?.stepIndex ?? null);
  const nextStep = nextStepIndex === null ? null : steps[nextStepIndex];
  const updatedSubmission = await recordActionFlowProgress({
    projectId: input.projectId,
    submissionId: input.submission.id,
    currentStepId: nextStep?.id ?? null,
    fields: nextFields,
    expectedRevision: input.submission.revision,
    metadata: editState
      ? updateFlowEditMetadata(
          input.submission.metadata,
          nextEditStepIndex === null ? null : nextEditPosition,
        )
      : input.submission.metadata,
    event: {
      eventType: "field.collected",
      message: fieldKey ? `Collected ${fieldKey}.` : "Collected flow field.",
      payload: {
        fieldKey,
        stepId: step.id,
        value: input.media,
      },
    },
  });

  if (!updatedSubmission) {
    return {
      replies: [
        createTextReply("I could not save that media. Please try again."),
      ],
    };
  }

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: updatedSubmission.id,
    eventType: "flow.media_uploaded",
    message: `Media received: ${formatFlowMediaUploadValue(input.media)}.`,
    payload: {
      fieldKey,
      stepId: step.id,
      value: input.media,
    },
  });

  if (branchDecision) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: updatedSubmission.id,
      eventType: "flow.branch_decision",
      message: "Flow route selected.",
      payload: branchDecision,
    });
  }

  return advanceFlowToNextStep({
    action: input.action,
    contactId: input.contactId ?? getSubmissionContactId(updatedSubmission),
    projectId: input.projectId,
    submission: updatedSubmission,
    stepIndex: nextStepIndex ?? steps.length,
  });
}

export async function processChannelFlowText(input: {
  activeSubmission: SelectActionSubmission | null;
  contactId?: number | null;
  conversationId: string;
  projectId: number;
  source: string;
  text: string;
}): Promise<ChannelRuntimeResult> {
  if (input.activeSubmission) {
    const action = await getRuntimeProjectActionForSubmission(
      input.projectId,
      input.activeSubmission,
    );

    if (!action) {
      await cancelActionFlowSubmission({
        projectId: input.projectId,
        submissionId: input.activeSubmission.id,
        expectedRevision: input.activeSubmission.revision,
      });
      return {
        replies: [
          createTextReply(
            "This request is no longer available. Please start a new request.",
          ),
        ],
      };
    }

    return continueChannelFlow({
      action,
      answer: input.text,
      contactId:
        input.contactId ?? getSubmissionContactId(input.activeSubmission),
      projectId: input.projectId,
      submission: input.activeSubmission,
    });
  }

  const actions = await listRuntimeProjectActions(input.projectId);
  const triggeredAction = findTriggeredAction(actions, input.text);

  if (!triggeredAction) {
    return {
      replies: [
        createTextReply(
          "I could not match that to an active flow yet. Please send one of the configured trigger phrases to start.",
        ),
      ],
    };
  }

  return startChannelFlow({
    action: triggeredAction,
    contactId: input.contactId ?? null,
    conversationId: input.conversationId,
    projectId: input.projectId,
    source: input.source,
  });
}

export async function processChannelFlowMedia(input: {
  activeSubmission: SelectActionSubmission | null;
  contactId?: number | null;
  media: FlowMediaUploadValue;
  projectId: number;
}): Promise<ChannelRuntimeResult> {
  if (!input.activeSubmission) {
    return {
      replies: [
        createTextReply(
          "I received the media, but no active flow is waiting for it. Please send a configured trigger phrase to start.",
        ),
      ],
    };
  }

  const action = await getRuntimeProjectActionForSubmission(
    input.projectId,
    input.activeSubmission,
  );

  if (!action) {
    await cancelActionFlowSubmission({
      projectId: input.projectId,
      submissionId: input.activeSubmission.id,
      expectedRevision: input.activeSubmission.revision,
    });
    return {
      replies: [
        createTextReply(
          "This request is no longer available. Please start a new request.",
        ),
      ],
    };
  }

  return continueChannelFlowMedia({
    action,
    contactId:
      input.contactId ?? getSubmissionContactId(input.activeSubmission),
    media: input.media,
    projectId: input.projectId,
    submission: input.activeSubmission,
  });
}
