import { NextResponse } from "next/server";
import { z } from "zod";
import { runBrowserFlowText } from "@/lib/browser-flow-runtime";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

const requestSchema = z
  .object({
    actionId: z.number().int().positive().optional(),
    conversationId: z.string().trim().min(1).max(120),
    editSection: z
      .enum(["all", "email", "name", "phone", "schedule", "service"])
      .optional(),
    resume: z.boolean().optional(),
    text: z.string().max(4000).optional(),
    token: z.string().trim().min(1).max(256),
  })
  .strict();

async function readJsonBody(req: Request) {
  try {
    return { body: await req.json(), isValidJson: true } as const;
  } catch {
    return { body: null, isValidJson: false } as const;
  }
}

export async function POST(req: Request) {
  try {
    const json = await readJsonBody(req);
    const parsed = requestSchema.safeParse(json.body);

    if (
      !json.isValidJson ||
      !parsed.success ||
      (!parsed.data.actionId &&
        !parsed.data.editSection &&
        !parsed.data.resume &&
        !parsed.data.text?.trim())
    ) {
      return NextResponse.json(
        { message: "A flow action or message is required." },
        { status: 400 },
      );
    }

    const accessResult = await resolveWidgetTokenAccessForRequest({
      headers: req.headers,
      token: parsed.data.token,
    });

    if (!accessResult.widgetAccess) {
      return NextResponse.json(
        { message: accessResult.message ?? "Widget is unavailable." },
        { status: accessResult.status ?? 403 },
      );
    }

    const result = await runBrowserFlowText({
      actionId: parsed.data.actionId,
      channelType: "widget",
      conversationId: parsed.data.conversationId,
      editSection: parsed.data.editSection,
      projectId: accessResult.widgetAccess.projectId,
      resume: parsed.data.resume,
      source: "widget_chat",
      text: parsed.data.text,
    });

    if (parsed.data.actionId && !result.handled) {
      return NextResponse.json(
        { message: "Action is unavailable." },
        { status: 404 },
      );
    }

    if (
      parsed.data.editSection &&
      !result.activeFlow &&
      result.replies.length === 0
    ) {
      return NextResponse.json(
        { message: "No active flow is available to edit." },
        { status: 409 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Widget browser flow runtime error:", error);
    return NextResponse.json(
      { message: "Failed to process the flow message." },
      { status: 500 },
    );
  }
}
