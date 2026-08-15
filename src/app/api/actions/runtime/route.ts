import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { browserChannelMessagesToFlowMessages } from "@/lib/browser-channel-adapter";
import {
  BrowserFlowCommandError,
  runBrowserFlowText,
} from "@/lib/browser-flow-runtime";
import { channelInboundSelectionInputV1Schema } from "@/lib/channel-inbound-contract";
import {
  getChannelConversation,
  listRecentChannelMessages,
} from "@/lib/channels";

const requestSchema = z
  .object({
    actionId: z.number().int().positive().optional(),
    announceStart: z.boolean().optional(),
    commandId: z.string().trim().min(1).max(120).optional(),
    conversationId: z.string().trim().min(1).max(120),
    editSection: z
      .enum(["all", "email", "name", "phone", "schedule", "service"])
      .optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    projectId: z.number().int().positive().optional(),
    resume: z.boolean().optional(),
    selection: channelInboundSelectionInputV1Schema.optional(),
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

async function loadProjectChatHistory(input: {
  conversationId: string;
  projectId: number;
}) {
  const conversation = await getChannelConversation({
    channelType: "project_chat",
    externalConversationId: input.conversationId,
    projectId: input.projectId,
  });
  if (!conversation) {
    return [];
  }

  return browserChannelMessagesToFlowMessages(
    "project_chat",
    await listRecentChannelMessages({
      conversationId: conversation.id,
      limit: 50,
      projectId: input.projectId,
    }),
  );
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

    if (!parsed.data.resume && !parsed.data.commandId) {
      return NextResponse.json(
        { message: "A command ID is required." },
        { status: 400 },
      );
    }

    const { project } = await resolveUserAndProject(parsed.data.projectId);
    const result = await runBrowserFlowText({
      actionId: parsed.data.actionId,
      announceStart: parsed.data.announceStart,
      channelType: "project_chat",
      commandId: parsed.data.commandId,
      conversationId: parsed.data.conversationId,
      editSection: parsed.data.editSection,
      expectedRevision: parsed.data.expectedRevision,
      projectId: project.id,
      resume: parsed.data.resume,
      selection: parsed.data.selection,
      source: "project_chat",
      text: parsed.data.text,
    });
    const history = parsed.data.resume
      ? await loadProjectChatHistory({
          conversationId: parsed.data.conversationId,
          projectId: project.id,
        })
      : undefined;

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

    return NextResponse.json(
      history === undefined ? result : { ...result, history },
    );
  } catch (error) {
    if (error instanceof BrowserFlowCommandError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: 409 },
      );
    }

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
