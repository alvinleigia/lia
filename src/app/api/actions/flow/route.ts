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
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import {
  getOrCreateChannelConversation,
  markChannelConversationForReview,
  recordChannelMessage,
} from "@/lib/channels";
import { executeContactMutationStep } from "@/lib/contact-flow-mutations";
import { buildHandoffMetadata, runHandoffNotification } from "@/lib/handoff";
import { getRuntimeProjectAction } from "@/lib/runtime-actions";

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

const flowRequestSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("start"),
    actionId: z.number().int().positive(),
    conversationId: z.string().trim().max(120).optional(),
    source: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    event: z.literal("progress"),
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
    submissionId: z.number().int().positive(),
    stepId: z.number().int().positive(),
    currentStepId: z.number().int().positive().nullable().optional(),
    fields: z.record(z.string(), z.unknown()),
    branchDecision: branchDecisionSchema.optional(),
  }),
  z.object({
    event: z.literal("handoff"),
    submissionId: z.number().int().positive(),
    stepId: z.number().int().positive(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    event: z.literal("submit"),
    submissionId: z.number().int().positive(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    event: z.literal("validation_failed"),
    submissionId: z.number().int().positive(),
    fieldKey: z.string().trim().max(120).optional(),
    message: z.string().trim().min(1).max(500),
    stepId: z.number().int().positive().optional(),
    value: z.unknown().optional(),
  }),
  z.object({
    event: z.literal("cancel"),
    submissionId: z.number().int().positive(),
  }),
]);

async function recordProjectChatChannelMessage(input: {
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
    channelType: "project_chat",
    externalConversationId: input.conversationId,
    direction: input.direction,
    text: input.text ?? null,
    payload: input.payload ?? {},
  });
}

export async function POST(req: Request) {
  try {
    const parsed = flowRequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid flow request." },
        { status: 400 },
      );
    }

    const { project } = await resolveUserAndProject();

    if (parsed.data.event === "start") {
      const conversation = parsed.data.conversationId
        ? await getOrCreateChannelConversation({
            projectId: project.id,
            channelType: "project_chat",
            externalConversationId: parsed.data.conversationId,
          })
        : null;
      const submission = await startActionFlowSubmission({
        projectId: project.id,
        actionId: parsed.data.actionId,
        contactId: conversation?.contactId ?? null,
        conversationId: parsed.data.conversationId ?? null,
        source: parsed.data.source ?? "project_chat",
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Action is unavailable." },
          { status: 404 },
        );
      }

      await recordProjectChatChannelMessage({
        projectId: project.id,
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
        project.id,
        mutation.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const action = await getRuntimeProjectAction(
        project.id,
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
        projectId: project.id,
        source: existingSubmission.source,
        step,
        submissionId: existingSubmission.id,
      });

      const submission = await recordActionFlowProgress({
        projectId: project.id,
        submissionId: existingSubmission.id,
        currentStepId: mutation.currentStepId ?? null,
        fields: mutation.fields,
      });

      if (mutation.branchDecision) {
        await addActionSubmissionEvent({
          projectId: project.id,
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
        project.id,
        handoffRequest.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const action = await getRuntimeProjectAction(
        project.id,
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
        projectId: project.id,
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
          channelType: "project_chat",
          externalConversationId: submission.conversationId,
          handoff: {
            ...handoff,
            submissionId: submission.id,
          },
          projectId: project.id,
        });
      }

      await addActionSubmissionEvent({
        eventType: "flow.handoff_requested",
        message: "Human handoff requested.",
        payload: handoff,
        projectId: project.id,
        submissionId: submission.id,
      });

      await runHandoffNotification({
        action,
        fields: handoffRequest.fields,
        handoff,
        projectId: project.id,
        step,
        submissionId: submission.id,
      });

      await recordProjectChatChannelMessage({
        projectId: project.id,
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
        project.id,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const validation = await validateActionFlowProgress({
        projectId: project.id,
        actionId: existingSubmission.actionId,
        stepId: parsed.data.stepId,
        value: parsed.data.value,
        fields: parsed.data.fields,
      });

      if (!validation.isValid) {
        await addActionSubmissionEvent({
          projectId: project.id,
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
        projectId: project.id,
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

      await recordProjectChatChannelMessage({
        projectId: project.id,
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
          projectId: project.id,
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
        project.id,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      const validation = await validateActionSubmissionFields({
        projectId: project.id,
        actionId: existingSubmission.actionId,
        fields: parsed.data.fields,
      });

      if (!validation.isValid) {
        await addActionSubmissionEvent({
          projectId: project.id,
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
        projectId: project.id,
        submissionId: parsed.data.submissionId,
        fields: parsed.data.fields,
      });

      if (!submission) {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      await recordProjectChatChannelMessage({
        projectId: project.id,
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
        project.id,
        parsed.data.submissionId,
      );

      if (!existingSubmission || existingSubmission.status !== "in_progress") {
        return NextResponse.json(
          { message: "Flow submission not found." },
          { status: 404 },
        );
      }

      await addActionSubmissionEvent({
        projectId: project.id,
        submissionId: existingSubmission.id,
        eventType: "flow.validation_failed",
        message: parsed.data.message,
        payload: {
          fieldKey: parsed.data.fieldKey ?? null,
          stepId: parsed.data.stepId ?? null,
          value: parsed.data.value ?? null,
        },
      });

      await recordProjectChatChannelMessage({
        projectId: project.id,
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
      projectId: project.id,
      submissionId: parsed.data.submissionId,
    });

    if (!submission) {
      return NextResponse.json(
        { message: "Flow submission not found." },
        { status: 404 },
      );
    }

    await recordProjectChatChannelMessage({
      projectId: project.id,
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
    if (isInactiveAccountError(error)) {
      return NextResponse.json(
        { message: "This account is currently disabled." },
        { status: 423 },
      );
    }

    console.error("Action flow error:", error);
    return NextResponse.json(
      { message: "Failed to update flow." },
      { status: 500 },
    );
  }
}
