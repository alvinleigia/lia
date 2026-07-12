import { NextResponse } from "next/server";
import { z } from "zod";
import { validateActionSubmissionFields } from "@/lib/action-flow-validation";
import {
  addActionSubmissionEvent,
  createActionSubmission,
  getProjectAction,
} from "@/lib/action-flows";
import { runSubmissionOperations } from "@/lib/operations";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

const widgetSubmissionSchema = z.object({
  token: z.string().min(1),
  actionId: z.number().int().positive(),
  fields: z.record(z.string(), z.unknown()),
  conversationId: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = widgetSubmissionSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid submission." },
        { status: 400 },
      );
    }

    const widgetAccessResult = await resolveWidgetTokenAccessForRequest({
      headers: req.headers,
      token: parsed.data.token,
    });

    if (!widgetAccessResult.widgetAccess) {
      return NextResponse.json(
        { message: widgetAccessResult.message ?? "Widget is unavailable." },
        { status: widgetAccessResult.status ?? 403 },
      );
    }
    const { widgetAccess } = widgetAccessResult;

    const action = await getProjectAction(
      widgetAccess.projectId,
      parsed.data.actionId,
    );

    if (!action || action.status !== "active") {
      return NextResponse.json(
        { message: "Action is unavailable." },
        { status: 404 },
      );
    }

    const validation = await validateActionSubmissionFields({
      projectId: widgetAccess.projectId,
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
      projectId: widgetAccess.projectId,
      actionId: action.id,
      status: "submitted",
      source: "widget_chat",
      conversationId: parsed.data.conversationId ?? null,
      fields: parsed.data.fields,
      metadata: {
        actionName: action.name,
      },
    });

    await addActionSubmissionEvent({
      projectId: widgetAccess.projectId,
      submissionId: submission.id,
      eventType: "submission.created",
      message: "Submission created from widget chat.",
      payload: { actionId: action.id, source: submission.source },
    });

    await addActionSubmissionEvent({
      projectId: widgetAccess.projectId,
      submissionId: submission.id,
      eventType: "submission.submitted",
      message: "Submission marked as submitted.",
      payload: { fields: parsed.data.fields },
    });
    await runSubmissionOperations(widgetAccess.projectId, submission.id);

    return NextResponse.json({
      submissionId: submission.id,
      status: submission.status,
    });
  } catch (error) {
    console.error("Widget action submission error:", error);
    return NextResponse.json(
      { message: "Failed to save submission." },
      { status: 500 },
    );
  }
}
