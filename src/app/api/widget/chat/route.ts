import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { buildKnowledgeChatSystemPrompt } from "@/lib/ai-guardrails";
import { logChatRequest } from "@/lib/chat-logs";
import { projectHasIndexedDocuments } from "@/lib/documents";
import { searchDocuments } from "@/lib/search";
import {
  extractRequestOrigin,
  isOriginAllowed,
  resolveWidgetTokenAccess,
} from "@/lib/widget-keys";
import { isWidgetRateLimited } from "@/lib/widget-rate-limit";

type WidgetChatBody = {
  token?: string;
  messages?: UIMessage[];
};

const MAX_WIDGET_CONTEXT_MESSAGES = 16;
const WIDGET_RATE_LIMIT_WINDOW_MS = 60_000;
const WIDGET_RATE_LIMIT_MAX_REQUESTS = 30;

function limitContextMessages(messages: UIMessage[]) {
  if (messages.length <= MAX_WIDGET_CONTEXT_MESSAGES) {
    return messages;
  }

  return messages.slice(-MAX_WIDGET_CONTEXT_MESSAGES);
}

function extractToken(req: Request, bodyToken?: string) {
  const url = new URL(req.url);
  return bodyToken ?? url.searchParams.get("token") ?? "";
}

function extractClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  const startMs = Date.now();
  try {
    const body = (await req.json()) as WidgetChatBody;
    const token = extractToken(req, body.token);
    if (!token) {
      await logChatRequest({
        route: "widget",
        projectId: null,
        statusCode: 401,
        latencyMs: Date.now() - startMs,
        errorCode: "missing_token",
      });
      return new Response("Missing token", { status: 401 });
    }

    const widgetAccess = await resolveWidgetTokenAccess(token);
    if (!widgetAccess) {
      await logChatRequest({
        route: "widget",
        projectId: null,
        statusCode: 401,
        latencyMs: Date.now() - startMs,
        errorCode: "invalid_token",
      });
      return new Response("Invalid token", { status: 401 });
    }
    if (!widgetAccess.isTenantActive) {
      await logChatRequest({
        route: "widget",
        projectId: widgetAccess.projectId,
        statusCode: 423,
        latencyMs: Date.now() - startMs,
        errorCode: "tenant_disabled",
      });
      return new Response("This account is currently disabled.", {
        status: 423,
      });
    }
    if (widgetAccess.isArchived) {
      await logChatRequest({
        route: "widget",
        projectId: widgetAccess.projectId,
        statusCode: 423,
        latencyMs: Date.now() - startMs,
        errorCode: "project_archived",
      });
      return new Response("This project is currently disabled.", {
        status: 423,
      });
    }
    if (!widgetAccess.isActive) {
      await logChatRequest({
        route: "widget",
        projectId: widgetAccess.projectId,
        statusCode: 403,
        latencyMs: Date.now() - startMs,
        errorCode: "widget_disabled",
      });
      return new Response("This widget is currently disabled.", {
        status: 403,
      });
    }

    const requestOrigin = extractRequestOrigin(req.headers);
    if (!isOriginAllowed(requestOrigin, widgetAccess.allowedDomains)) {
      await logChatRequest({
        route: "widget",
        projectId: widgetAccess.projectId,
        statusCode: 403,
        latencyMs: Date.now() - startMs,
        errorCode: "origin_not_allowed",
      });
      return new Response("Origin not allowed", { status: 403 });
    }

    const clientIp = extractClientIp(req);
    const limited = await isWidgetRateLimited(token, clientIp, {
      maxRequests: WIDGET_RATE_LIMIT_MAX_REQUESTS,
      windowMs: WIDGET_RATE_LIMIT_WINDOW_MS,
    });
    if (limited) {
      await logChatRequest({
        route: "widget",
        projectId: widgetAccess.projectId,
        statusCode: 429,
        latencyMs: Date.now() - startMs,
        errorCode: "rate_limited",
      });
      return new Response("Too many requests", { status: 429 });
    }

    const messages = limitContextMessages(body.messages ?? []);
    const hasDocuments = await projectHasIndexedDocuments(
      widgetAccess.projectId,
    );
    const result = streamText({
      model: openai("gpt-5-mini"),
      messages: await convertToModelMessages(messages),
      tools: hasDocuments
        ? {
            searchKnowledgeBase: tool({
              description: "Search the knowledge base for relevant information",
              inputSchema: z.object({
                query: z
                  .string()
                  .describe("The search query to find relevant documents"),
              }),
              execute: async ({ query }) => {
                const results = await searchDocuments(
                  widgetAccess.projectId,
                  query,
                );
                if (results.length === 0) {
                  return "No relevant verified internal information found for this question.";
                }
                return results
                  .map((r, i) => `[${i + 1}] ${r.content}`)
                  .join("\n\n");
              },
            }),
          }
        : undefined,
      system: buildKnowledgeChatSystemPrompt({
        channel: "widget_chat",
        projectAiSettings: widgetAccess.projectAiSettings,
        companyName: widgetAccess.companyName,
        hasDocuments,
        projectName: widgetAccess.projectName,
      }),
      stopWhen: stepCountIs(2),
      onFinish: async ({ usage }) => {
        const promptTokens =
          (usage as { inputTokens?: number; promptTokens?: number })
            ?.inputTokens ??
          (usage as { inputTokens?: number; promptTokens?: number })
            ?.promptTokens ??
          null;
        const completionTokens =
          (usage as { outputTokens?: number; completionTokens?: number })
            ?.outputTokens ??
          (usage as { outputTokens?: number; completionTokens?: number })
            ?.completionTokens ??
          null;
        const totalTokens =
          (usage as { totalTokens?: number })?.totalTokens ??
          (promptTokens !== null && completionTokens !== null
            ? promptTokens + completionTokens
            : null);

        await logChatRequest({
          route: "widget",
          projectId: widgetAccess.projectId,
          statusCode: 200,
          latencyMs: Date.now() - startMs,
          promptTokens,
          completionTokens,
          totalTokens,
        });
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Widget chat error:", error);
    await logChatRequest({
      route: "widget",
      projectId: null,
      statusCode: 500,
      latencyMs: Date.now() - startMs,
      errorCode: error instanceof Error ? error.message : "unknown_error",
    });
    return new Response("Failed to process widget chat", { status: 500 });
  }
}
