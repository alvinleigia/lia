import { NextResponse } from "next/server";
import { z } from "zod";
import { validateActionSubmissionFields } from "@/lib/action-flow-validation";
import {
  addActionSubmissionEvent,
  createActionSubmission,
  getProjectAction,
} from "@/lib/action-flows";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { runSubmissionOperations } from "@/lib/operations";

const submissionSchema = z.object({
  actionId: z.number().int().positive(),
  fields: z.record(z.string(), z.unknown()),
  source: z.string().trim().min(1).max(80).optional(),
  conversationId: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = submissionSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid submission." },
        { status: 400 },
      );
    }

    const { project } = await resolveUserAndProject();
    const action = await getProjectAction(project.id, parsed.data.actionId);

    if (!action || action.status !== "active") {
      return NextResponse.json(
        { message: "Action is unavailable." },
        { status: 404 },
      );
    }

    const validation = await validateActionSubmissionFields({
      projectId: project.id,
      actionId: action.id,
      fields: parsed.data.fields,
    });

    if (!validation.isValid) {
      return NextResponse.json(
        {
          message: "Submission fields are incomplete or invalid.",
          issues: validation.issues,
        },
        { status: 400 },
      );
    }

    const submission = await createActionSubmission({
      projectId: project.id,
      actionId: action.id,
      status: "submitted",
      source: parsed.data.source ?? "project_chat",
      conversationId: parsed.data.conversationId ?? null,
      fields: parsed.data.fields,
      metadata: {
        actionName: action.name,
      },
    });

    await addActionSubmissionEvent({
      projectId: project.id,
      submissionId: submission.id,
      eventType: "submission.created",
      message: "Submission created from project chat.",
      payload: { actionId: action.id, source: submission.source },
    });

    await addActionSubmissionEvent({
      projectId: project.id,
      submissionId: submission.id,
      eventType: "submission.submitted",
      message: "Submission marked as submitted.",
      payload: { fields: parsed.data.fields },
    });
    await runSubmissionOperations(project.id, submission.id);

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

    console.error("Action submission error:", error);
    return NextResponse.json(
      { message: "Failed to save submission." },
      { status: 500 },
    );
  }
}
