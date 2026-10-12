import { openai } from "@ai-sdk/openai";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import {
  compactTaskExtractionProviderSchema,
  compactTaskKnowledgeProviderSchema,
  expandCompactTaskTurn,
  type TurnMessageV1,
  turnResultV1ProviderSchema,
} from "@/lib/conversation-turn-contracts";
import {
  MeteredModelError,
  type ModelUsage,
  normalizeModelUsage,
} from "@/lib/model-usage";

export const PLATFORM_DEFAULT_MODEL_ID = "gpt-5-mini";
export const PLATFORM_FALLBACK_MODEL_ID = "gpt-4.1-mini";
export const PLATFORM_EXTRACTION_MODEL_ID = "gpt-4.1-mini";
export const PLATFORM_EXTRACTION_FALLBACK_MODEL_ID = "gpt-5-mini";
export const PLATFORM_KNOWLEDGE_MODEL_ID = "gpt-4.1-mini";
export const PLATFORM_KNOWLEDGE_FALLBACK_MODEL_ID = "gpt-5-mini";
export const PLATFORM_EMBEDDING_MODEL_ID = "text-embedding-3-small";

export function getPlatformLanguageModel(
  modelId: string = PLATFORM_DEFAULT_MODEL_ID,
) {
  return openai(modelId);
}

export function getPlatformEmbeddingModel() {
  return openai.textEmbeddingModel(PLATFORM_EMBEDDING_MODEL_ID);
}

export type StructuredTurnProviderInput = {
  taskKnowledgeOnly?: boolean;
  taskExtractionOnly?: boolean;
  maxOutputTokens: number;
  maxRetries: number;
  messages: TurnMessageV1[];
  modelId: string;
  system: string;
  timeoutMs: number;
};

export type StructuredTurnProviderResult = {
  modelId: string;
  output: unknown;
  usage: ModelUsage;
};

export interface StructuredTurnProvider {
  generateTurn(
    input: StructuredTurnProviderInput,
  ): Promise<StructuredTurnProviderResult>;
}

export class StructuredTurnOutputLimitError extends MeteredModelError {
  constructor(usage: ModelUsage) {
    super(usage, new Error("Structured turn exceeded its output token limit."));
    this.name = "StructuredTurnOutputLimitError";
  }
}

export class AiSdkStructuredTurnProvider implements StructuredTurnProvider {
  async generateTurn(
    input: StructuredTurnProviderInput,
  ): Promise<StructuredTurnProviderResult> {
    const result = await generateText({
      model: getPlatformLanguageModel(input.modelId),
      output: Output.object({
        name: "StructuredTurnV1",
        description:
          "A proposal-only structured conversational turn for server validation.",
        schema: input.taskKnowledgeOnly
          ? compactTaskKnowledgeProviderSchema
          : input.taskExtractionOnly
            ? compactTaskExtractionProviderSchema
            : turnResultV1ProviderSchema,
      }),
      system:
        input.system +
        (input.taskExtractionOnly
          ? "\nFor ordinary field extraction, keep reply to a brief acknowledgement (at most eight words). Do not repeat supplied values or ask for remaining fields; the server renders the next prompt. Clarifications, safety refusals and handoffs still need clear wording. Server supplies schemaVersion, decisionSummary and candidate source; omit them from your output."
          : input.taskKnowledgeOnly
            ? "\nServer supplies the omitted constant fields and audit summary. Return only the requested compact answer object."
            : ""),
      messages: input.messages,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: input.maxRetries,
      providerOptions: input.modelId.startsWith("gpt-5")
        ? {
            openai: {
              reasoningEffort: "low",
              strictJsonSchema: true,
              textVerbosity: "low",
            },
          }
        : undefined,
      timeout: input.timeoutMs,
    }).catch((error: unknown) => {
      if (NoObjectGeneratedError.isInstance(error)) {
        if (error.finishReason === "length")
          throw new StructuredTurnOutputLimitError(
            normalizeModelUsage(error.usage),
          );
        throw new MeteredModelError(normalizeModelUsage(error.usage), error);
      }
      throw error;
    });
    const usage = normalizeModelUsage(result.totalUsage);
    // Reasoning can exhaust the budget before any structured output exists.
    // Preserve usage and let the engine try the configured fallback directly.
    if (result.finishReason === "length")
      throw new StructuredTurnOutputLimitError(usage);
    try {
      return {
        modelId: input.modelId,
        output: input.taskKnowledgeOnly
          ? expandCompactTaskTurn(result.output, "knowledge")
          : input.taskExtractionOnly
            ? expandCompactTaskTurn(result.output, "extraction")
            : result.output,
        usage,
      };
    } catch (error) {
      throw new MeteredModelError(usage, error);
    }
  }
}
