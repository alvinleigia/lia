import { NextResponse } from "next/server";
import { z } from "zod";
import { runBrowserFlowText } from "@/lib/browser-flow-runtime";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

const requestSchema = z.object({
  actionId: z.number().int().positive().optional(),
  conversationId: z.string().trim().min(1).max(120),
  editSection: z
    .enum(["all", "email", "name", "phone", "schedule", "service"])
    .optional(),
  text: z.string().max(4000).optional(),
  token: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());

    if (
      !parsed.success ||
      (!parsed.data.actionId &&
        !parsed.data.editSection &&
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
      source: "widget_chat",
      text: parsed.data.text,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Widget browser flow runtime error:", error);
    return NextResponse.json(
      { message: "Failed to process the flow message." },
      { status: 500 },
    );
  }
}
