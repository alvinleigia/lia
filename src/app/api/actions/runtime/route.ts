import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { runBrowserFlowText } from "@/lib/browser-flow-runtime";

const requestSchema = z
  .object({
    actionId: z.number().int().positive().optional(),
    conversationId: z.string().trim().min(1).max(120),
    editSection: z
      .enum(["all", "email", "name", "phone", "schedule", "service"])
      .optional(),
    projectId: z.number().int().positive().optional(),
    text: z.string().max(4000).optional(),
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
        !parsed.data.text?.trim())
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
      editSection: parsed.data.editSection,
      projectId: project.id,
      source: "project_chat",
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
