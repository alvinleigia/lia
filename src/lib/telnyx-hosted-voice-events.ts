import { z } from "zod";

const telnyxConversationEndedSchema = z.object({
  data: z.object({
    event_type: z.literal("call.conversation.ended"),
    id: z.string().trim().min(1).max(240),
    occurred_at: z.string().datetime({ offset: true }),
    payload: z.object({
      assistant_id: z.string().trim().min(1).max(240),
      call_control_id: z.string().trim().min(1).max(240),
      conversation_id: z.string().trim().min(1).max(240),
      duration_sec: z.number().int().min(0).max(86_400),
      llm_model: z.string().trim().min(1).max(240),
      reason: z.string().trim().min(1).max(120).default("unknown"),
      stt_model: z.string().trim().min(1).max(240),
      tts_model_id: z.string().trim().min(1).max(240),
      tts_provider: z.string().trim().min(1).max(120),
    }),
  }),
});

const telnyxConversationInsightsSchema = z.object({
  data: z.object({
    event_type: z.literal("call.conversation_insights.generated"),
    id: z.string().trim().min(1).max(240),
  }),
});

export const telnyxHostedVoicePostCallEventSchema = z.union([
  telnyxConversationEndedSchema,
  telnyxConversationInsightsSchema,
]);

export function getTelnyxHostedVoiceConversationEnded(value: unknown) {
  const parsed = telnyxConversationEndedSchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data.data;
  return {
    assistantId: data.payload.assistant_id,
    callControlId: data.payload.call_control_id,
    durationMs: data.payload.duration_sec * 1_000,
    endedAt: new Date(data.occurred_at),
    eventId: data.id,
    llmModel: data.payload.llm_model,
    reason: data.payload.reason,
    sttModel: data.payload.stt_model,
    ttsModel: data.payload.tts_model_id,
    ttsProvider: data.payload.tts_provider,
  };
}
