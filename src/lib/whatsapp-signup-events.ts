import { z } from "zod";

const eventSchema = z.object({
  type: z.literal("WA_EMBEDDED_SIGNUP"),
  event: z.string(),
  data: z
    .object({
      waba_id: z
        .string()
        .regex(/^\d{1,40}$/)
        .optional(),
      phone_number_id: z
        .string()
        .regex(/^\d{1,40}$/)
        .optional(),
    })
    .optional(),
});

export function parseWhatsAppSignupEvent(origin: string, value: unknown) {
  if (
    !["https://www.facebook.com", "https://web.facebook.com"].includes(origin)
  )
    return null;
  try {
    const parsed = eventSchema.safeParse(
      typeof value === "string" ? JSON.parse(value) : value,
    );
    if (!parsed.success) return null;
    const event = parsed.data;
    if (event.event === "CANCEL" || event.event === "ERROR")
      return { kind: "cancelled" as const };
    if (event.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
      return { kind: "unsupported" as const };
    if (event.event !== "FINISH") return null;
    if (!event.data?.waba_id || !event.data.phone_number_id)
      return { kind: "incomplete" as const };
    return {
      kind: "finished" as const,
      businessAccountId: event.data.waba_id,
      phoneNumberId: event.data.phone_number_id,
    };
  } catch {
    return null;
  }
}
