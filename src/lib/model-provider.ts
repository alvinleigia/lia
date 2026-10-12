import { openai } from "@ai-sdk/openai";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import {
  type TurnMessageV1,
  taskKnowledgeTurnProviderSchema,
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
          ? taskKnowledgeTurnProviderSchema
          : turnResultV1ProviderSchema,
      }),
      system: input.system,
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
      return { modelId: input.modelId, output: result.output, usage };
    } catch (error) {
      throw new MeteredModelError(usage, error);
    }
  }
}
