// src/app/api/chat/route.ts

import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { logChatRequest } from "@/lib/chat-logs";
import { projectHasIndexedDocuments } from "@/lib/documents";
import { searchDocuments } from "@/lib/search";

export type ChatMessage = UIMessage;

const MAX_CONTEXT_MESSAGES = 16;

function limitContextMessages(messages: ChatMessage[]) {
  if (messages.length <= MAX_CONTEXT_MESSAGES) {
    return messages;
  }

  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

export async function POST(req: Request) {
  const startMs = Date.now();
  try {
    const {
      messages,
      projectId,
    }: { messages: ChatMessage[]; projectId?: number } = await req.json();
    const { project } = await resolveUserAndProject(projectId);
    const contextMessages = limitContextMessages(messages);
    const hasDocuments = await projectHasIndexedDocuments(project.id);

    const result = streamText({
      model: openai("gpt-5-mini"),
      messages: await convertToModelMessages(contextMessages),
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
                try {
                  const results = await searchDocuments(project.id, query);

                  if (results.length === 0) {
                    return "No relevant information found in the knowledge base.";
                  }

                  return results
                    .map((r, i) => `[${i + 1}] ${r.content}`)
                    .join("\n\n");
                } catch (error) {
                  console.error("Search error:", error);
                  return "Error searching the knowledge base.";
                }
              },
            }),
          }
        : undefined,
      system: `You are a helpful assistant with access to a knowledge base. 
          When users ask questions, search the knowledge base for relevant information.
          Always search before answering if the question might relate to uploaded documents.
          Base your answers on the search results when available. Give concise answers that correctly answer what the user is asking for. Do not flood them with all the information from the search results.
          ${hasDocuments ? "" : "This project currently has no indexed documents. If asked about project data, clearly mention that documents need to be uploaded first."}`,
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
          route: "chat",
          projectId: project.id,
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
    const status =
      error instanceof Error && error.message === "Unauthorized"
        ? 401
        : isInactiveAccountError(error)
          ? 423
          : 500;
    if (status === 500) {
      console.error("Error streaming chat completion:", error);
    }
    await logChatRequest({
      route: "chat",
      projectId: null,
      statusCode: status,
      latencyMs: Date.now() - startMs,
      errorCode: error instanceof Error ? error.message : "unknown_error",
    });
    return new Response(
      status === 423
        ? "This account is currently disabled."
        : "Failed to stream chat completion",
      { status },
    );
  }
}
