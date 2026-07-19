import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { runBrowserFlowText } from "@/lib/browser-flow-runtime";

const requestSchema = z.object({
  actionId: z.number().int().positive().optional(),
  conversationId: z.string().trim().min(1).max(120),
  projectId: z.number().int().positive().optional(),
  text: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());

    if (
      !parsed.success ||
      (!parsed.data.actionId && !parsed.data.text?.trim())
    ) {
      return NextResponse.json(
        { message: "A flow action or message is required." },
        { status: 400 },
      );
    }

    const { project } = await resolveUserAndProject(parsed.data.projectId);
    const result = await runBrowserFlowText({
      actionId: parsed.data.actionId,
      channelType: "project_chat",
      conversationId: parsed.data.conversationId,
      projectId: project.id,
      source: "project_chat",
      text: parsed.data.text,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isInactiveAccountError(error)) {
      return NextResponse.json(
        { message: "This account is currently disabled." },
        { status: 423 },
      );
    }

    console.error("Project browser flow runtime error:", error);
    return NextResponse.json(
      { message: "Failed to process the flow message." },
      { status: 500 },
    );
  }
}
