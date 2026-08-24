import { createHash } from "node:crypto";
import { z } from "zod";

export const HOSTED_VOICE_TOOL_PHASES = ["commit", "prepare", "read"] as const;

export const hostedVoiceToolEnvelopeSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(240),
    input: z.record(z.string(), z.unknown()),
    phase: z.enum(HOSTED_VOICE_TOOL_PHASES),
    provider: z.string().trim().min(1).max(80),
    providerCallId: z.string().trim().min(1).max(240),
    toolId: z.string().trim().min(1).max(120),
  })
  .strict();

export type HostedVoiceToolEnvelope = z.infer<
  typeof hostedVoiceToolEnvelopeSchema
>;

export interface HostedVoiceToolProviderAdapter<TRawRequest> {
  readonly provider: string;
  normalize(input: {
    phase: (typeof HOSTED_VOICE_TOOL_PHASES)[number];
    raw: TRawRequest;
    toolId: string;
  }): HostedVoiceToolEnvelope;
}

export type TelnyxHostedVoiceToolRequest = {
  body: unknown;
  headers: Headers;
};

export const telnyxHostedVoiceToolAdapter: HostedVoiceToolProviderAdapter<TelnyxHostedVoiceToolRequest> =
  {
    provider: "telnyx",
    normalize({ phase, raw, toolId }) {
      const conversationId = raw.headers
        .get("x-telnyx-call-control-id")
        ?.trim();
      if (!conversationId) {
        throw new HostedVoiceToolRequestError(
          "missing_provider_conversation",
          "The provider conversation could not be verified.",
          400,
        );
      }
      const input = safeRecordSchema.parse(raw.body);
      return hostedVoiceToolEnvelopeSchema.parse({
        conversationId,
        input,
        phase,
        provider: "telnyx",
        providerCallId: hashHostedVoiceToolValue({
          conversationId,
          input,
          phase,
          toolId,
        }),
        toolId,
      });
    },
  };

export class HostedVoiceToolRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HostedVoiceToolRequestError";
  }
}

export function hashHostedVoiceToolValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function getHostedVoiceBearerCredential(headers: Headers) {
  const authorization = headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    throw new HostedVoiceToolRequestError(
      "unauthorized",
      "Hosted voice tool authentication failed.",
      401,
    );
  }
  return match[1];
}

const safeRecordSchema = z.record(z.string(), z.unknown());

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
