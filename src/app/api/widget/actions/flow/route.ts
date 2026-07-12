import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cancelActionFlowSubmission,
  recordActionFlowProgress,
  startActionFlowSubmission,
  submitActionFlowSubmission,
} from "@/lib/action-flow-submissions";
import {
  validateActionFlowProgress,
  validateActionSubmissionFields,
} from "@/lib/action-flow-validation";
import {
  addActionSubmissionEvent,
  getActionSubmission,
  markActionSubmissionForReview,
} from "@/lib/action-flows";
import {
  getOrCreateChannelConversation,
  markChannelConversationForReview,
  recordChannelMessage,
} from "@/lib/channels";
import { executeContactMutationStep } from "@/lib/contact-flow-mutations";
import { buildHandoffMetadata, runHandoffNotification } from "@/lib/handoff";
import { getRuntimeProjectAction } from "@/lib/runtime-actions";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

const branchDecisionSchema = z.object({
  routeType: z.enum([
    "branch",
    "default_next_step",
    "ordered_next_step",
    "end",
  ]),
  sourceStepId: z.number().int().positive(),
  targetStepId: z.number().int().positive().nullable(),
  branchRuleId: z.number().int().positive().optional(),
});

const widgetFlowRequestSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("start"),
    token: z.string().min(1),
    actionId: z.number().int().positive(),
    conversationId: z.string().trim().max(120).optional(),
  }),
  z.object({
    event: z.literal("progress"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
    currentStepId: z.number().int().positive().nullable().optional(),
    fields: z.record(z.string(), z.unknown()),
    fieldKey: z.string().trim().max(120).optional(),
    stepId: z.number().int().positive().optional(),
    value: z.unknown().optional(),
    branchDecision: branchDecisionSchema.optional(),
  }),
  z.object({
    event: z.literal("mutation"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
    stepId: z.number().int().positive(),
    currentStepId: z.number().int().positive().nullable().optional(),
    fields: z.record(z.string(), z.unknown()),
    branchDecision: branchDecisionSchema.optional(),
  }),
  z.object({
    event: z.literal("handoff"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
    stepId: z.number().int().positive(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    event: z.literal("submit"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    event: z.literal("validation_failed"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
    fieldKey: z.string().trim().max(120).optional(),
    message: z.string().trim().min(1).max(500),
    stepId: z.number().int().positive().optional(),
    value: z.unknown().optional(),
  }),
  z.object({
    event: z.literal("cancel"),
    token: z.string().min(1),
    submissionId: z.number().int().positive(),
  }),
]);

async function resolveProjectIdForToken(token: string, headers: Headers) {
  const result = await resolveWidgetTokenAccessForRequest({ headers, token });

  if (!result.widgetAccess) {
    return {
      message: result.message,
      projectId: null,
      status: result.status,
    };
  }

  return {
    message: null,
    projectId: result.widgetAccess.projectId,
    status: null,
  };
}

async function recordWidgetChannelMessage(input: {
  projectId: number;
  conversationId?: string | null;
  direction: "inbound" | "outbound";
  text?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (!input.conversationId) {
    return;
  }

  await recordChannelMessage({
    projectId: input.projectId,
    channelType: "widget",
    externalConversationId: input.conversationId,
    direction: input.direction,
    text: input.text ?? null,
    payload: input.payload ?? {},
  });
}

export async function POST(req: Request) {
  try {
    const parsed = widgetFlowRequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid flow request." },
        { status: 400 },
      );
    }

    const projectAccess = await resolveProjectIdForToken(
      parsed.data.token,
      req.headers,
    );

    if (!projectAccess.projectId) {
      return NextResponse.json(
        { message: projectAccess.message ?? "Widget is unavailable." },
        { status: projectAccess.status ?? 403 },
      );
    }
    const projectId = projectAccess.projectId;

    if (parsed.data.event === "start") {
      const conversation = parsed.data.conversationId
        ? await getOrCreateChannelConversation({
            projectId,
            channelType: "widget",
            externalConversationId: parsed.data.conversationId,
          })
        : null;
      const submission = await startActionFlowSubmission({
        projectId,
        actionId: parsed.data.actionId,
        contactId: conversation?.contactId ?? null,
        conversationId: parsed.data.conversationId ?? null,
        source: "widget_chat",
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Action is unavailable." },
          { status: 404 },
        );
      }

      await recordWidgetChannelMessage({
        projectId,
        conversationId: submission.conversationId,
        direction: "outbound",
        text: "Started action flow.",
        payload: {
          actionId: submission.actionId,
          event: "flow.started",
          submissionId: submission.id,
        },
      });

      return NextResponse.json({
        currentStepId: submission.currentStepId,
        submissionId: submission.id,
        status: submission.status,
      });
    }

    if (parsed.data.event === "mutation") {
      const mutation = parsed.data;
      const existingSubmission = await getActionSubmission(
        projectId,
        mutation.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const action = await getRuntimeProjectAction(
        projectId,
        existingSubmission.actionId,
      );
      const step = action?.steps.find((item) => item.id === mutation.stepId);

      if (!action || !step) {
        return NextResponse.json(
          { message: "Flow step not found." },
          { status: 404 },
        );
      }

      const contactId =
        typeof existingSubmission.metadata.contactId === "number"
          ? existingSubmission.metadata.contactId
          : null;
      await executeContactMutationStep({
        contactId,
        fields: mutation.fields,
        projectId,
        source: existingSubmission.source,
        step,
        submissionId: existingSubmission.id,
      });

      const submission = await recordActionFlowProgress({
        projectId,
        submissionId: existingSubmission.id,
        currentStepId: mutation.currentStepId ?? null,
        fields: mutation.fields,
      });

      if (mutation.branchDecision) {
        await addActionSubmissionEvent({
          projectId,
          submissionId: existingSubmission.id,
          eventType: "flow.branch_decision",
          message: "Flow route selected.",
          payload: mutation.branchDecision,
        });
      }

      return NextResponse.json({
        currentStepId: submission?.currentStepId ?? null,
        submissionId: existingSubmission.id,
        status: submission?.status ?? existingSubmission.status,
      });
    }

    if (parsed.data.event === "handoff") {
      const handoffRequest = parsed.data;
      const existingSubmission = await getActionSubmission(
        projectId,
        handoffRequest.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const action = await getRuntimeProjectAction(
        projectId,
        existingSubmission.actionId,
      );
      const step = action?.steps.find(
        (item) => item.id === handoffRequest.stepId,
      );

      if (!action || !step || step.stepType !== "handoff") {
        return NextResponse.json(
          { message: "Handoff step not found." },
          { status: 404 },
        );
      }

      const handoff = buildHandoffMetadata({
        action,
        step,
        submission: existingSubmission,
      });
      const submission = await markActionSubmissionForReview({
        currentStepId: step.id,
        fields: handoffRequest.fields,
        handoff,
        projectId,
        submissionId: existingSubmission.id,
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      if (submission.conversationId) {
        await markChannelConversationForReview({
          channelType: "widget",
          externalConversationId: submission.conversationId,
          handoff: {
            ...handoff,
            submissionId: submission.id,
          },
          projectId,
        });
      }

      await addActionSubmissionEvent({
        eventType: "flow.handoff_requested",
        message: "Human handoff requested.",
        payload: handoff,
        projectId,
        submissionId: submission.id,
      });

      await runHandoffNotification({
        action,
        fields: handoffRequest.fields,
        handoff,
        projectId,
        step,
        submissionId: submission.id,
      });

      await recordWidgetChannelMessage({
        projectId,
        conversationId: submission.conversationId,
        direction: "outbound",
        text: step.prompt ?? step.label ?? "Human handoff requested.",
        payload: {
          event: "flow.handoff_requested",
          handoff,
          submissionId: submission.id,
        },
      });

      return NextResponse.json({
        currentStepId: submission.currentStepId,
        submissionId: submission.id,
        status: submission.status,
      });
    }

    if (parsed.data.event === "progress") {
      const existingSubmission = await getActionSubmission(
        projectId,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const validation = await validateActionFlowProgress({
        projectId,
        actionId: existingSubmission.actionId,
        stepId: parsed.data.stepId,
        value: parsed.data.value,
        fields: parsed.data.fields,
      });

      if (!validation.isValid) {
        await addActionSubmissionEvent({
          projectId,
          submissionId: existingSubmission.id,
          eventType: "flow.validation_failed",
          message: "Flow answer failed validation.",
          payload: { issues: validation.issues },
        });

        return NextResponse.json(
          {
            message: "Invalid flow answer.",
            issues: validation.issues,
          },
          { status: 400 },
        );
      }

      const submission = await recordActionFlowProgress({
        projectId,
        submissionId: parsed.data.submissionId,
        currentStepId: parsed.data.currentStepId ?? null,
        fields: parsed.data.fields,
        event: {
          eventType: "field.collected",
          message: parsed.data.fieldKey
            ? `Collected ${parsed.data.fieldKey}.`
            : "Collected flow field.",
          payload: {
            fieldKey: parsed.data.fieldKey ?? null,
            stepId: parsed.data.stepId ?? null,
            value: parsed.data.value ?? null,
          },
        },
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      await recordWidgetChannelMessage({
        projectId,
        conversationId: submission.conversationId,
        direction: "inbound",
        text:
          parsed.data.value === undefined ? null : String(parsed.data.value),
        payload: {
          event: "field.collected",
          fieldKey: parsed.data.fieldKey ?? null,
          stepId: parsed.data.stepId ?? null,
        },
      });

      if (parsed.data.branchDecision) {
        await addActionSubmissionEvent({
          projectId,
          submissionId: submission.id,
          eventType: "flow.branch_decision",
          message: "Flow route selected.",
          payload: parsed.data.branchDecision,
        });
      }

      return NextResponse.json({
        currentStepId: submission.currentStepId,
        submissionId: submission.id,
        status: submission.status,
      });
    }

    if (parsed.data.event === "submit") {
      const existingSubmission = await getActionSubmission(
        projectId,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const validation = await validateActionSubmissionFields({
        projectId,
        actionId: existingSubmission.actionId,
        fields: parsed.data.fields,
      });

      if (!validation.isValid) {
        await addActionSubmissionEvent({
          projectId,
          submissionId: existingSubmission.id,
          eventType: "flow.validation_failed",
          message: "Flow submission failed validation.",
          payload: { issues: validation.issues },
        });

        return NextResponse.json(
          {
            message: "Submission fields are incomplete or invalid.",
            issues: validation.issues,
          },
          { status: 400 },
        );
      }

      const submission = await submitActionFlowSubmission({
        projectId,
        submissionId: parsed.data.submissionId,
        fields: parsed.data.fields,
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      await recordWidgetChannelMessage({
        projectId,
        conversationId: submission.conversationId,
        direction: "outbound",
        text: "Submission saved.",
        payload: {
          event: "submission.submitted",
          submissionId: submission.id,
        },
      });

      return NextResponse.json({
        submissionId: submission.id,
        status: submission.status,
      });
    }

    if (parsed.data.event === "validation_failed") {
      const existingSubmission = await getActionSubmission(
        projectId,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      await addActionSubmissionEvent({
        projectId,
        submissionId: existingSubmission.id,
        eventType: "flow.validation_failed",
        message: parsed.data.message,
        payload: {
          fieldKey: parsed.data.fieldKey ?? null,
          stepId: parsed.data.stepId ?? null,
          value: parsed.data.value ?? null,
        },
      });

      await recordWidgetChannelMessage({
        projectId,
        conversationId: existingSubmission.conversationId,
        direction: "inbound",
        text:
          parsed.data.value === undefined ? null : String(parsed.data.value),
        payload: {
          event: "flow.validation_failed",
          fieldKey: parsed.data.fieldKey ?? null,
          message: parsed.data.message,
          stepId: parsed.data.stepId ?? null,
        },
      });

      return NextResponse.json({
        submissionId: existingSubmission.id,
        status: existingSubmission.status,
      });
    }

    const submission = await cancelActionFlowSubmission({
      projectId,
      submissionId: parsed.data.submissionId,
    });

    if (!submission) {
      return NextResponse.json(
        { message: "Flow submission not found." },
        { status: 404 },
      );
    }

    await recordWidgetChannelMessage({
      projectId,
      conversationId: submission.conversationId,
      direction: "outbound",
      text: "Flow cancelled.",
      payload: {
        event: "flow.cancelled",
        submissionId: submission.id,
      },
    });

    return NextResponse.json({
      submissionId: submission.id,
      status: submission.status,
    });
  } catch (error) {
    console.error("Widget action flow error:", error);
    return NextResponse.json(
      { message: "Failed to update flow." },
      { status: 500 },
    );
  }
}
