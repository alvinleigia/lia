import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import {
  type TurnMessageV1,
  turnResultV1ProviderSchema,
} from "@/lib/conversation-turn-contracts";

export const PLATFORM_DEFAULT_MODEL_ID = "gpt-5-mini";
export const PLATFORM_FALLBACK_MODEL_ID = "gpt-4.1-mini";
export const PLATFORM_EXTRACTION_MODEL_ID = "gpt-4.1-mini";
export const PLATFORM_EXTRACTION_FALLBACK_MODEL_ID = "gpt-5-mini";
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
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export interface StructuredTurnProvider {
  generateTurn(
    input: StructuredTurnProviderInput,
  ): Promise<StructuredTurnProviderResult>;
}

function readTokenCount(
  usage: unknown,
  names: readonly string[],
): number | null {
  if (!usage || typeof usage !== "object") return null;
  for (const name of names) {
    const value = (usage as Record<string, unknown>)[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
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
        schema: turnResultV1ProviderSchema,
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
    });
    const inputTokens = readTokenCount(result.usage, [
      "inputTokens",
      "promptTokens",
    ]);
    const outputTokens = readTokenCount(result.usage, [
      "outputTokens",
      "completionTokens",
    ]);

    return {
      modelId: input.modelId,
      output: result.output,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          readTokenCount(result.usage, ["totalTokens"]) ??
          (inputTokens !== null && outputTokens !== null
            ? inputTokens + outputTokens
            : null),
      },
    };
  }
}
