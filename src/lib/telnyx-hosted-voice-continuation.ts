import { createHash } from "node:crypto";
import { z } from "zod";

const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";

export class TelnyxHostedVoiceContinuationError extends Error {
  constructor(
    readonly code: "call_ended" | "provider_rejected" | "provider_unavailable",
    readonly retryable: boolean,
  ) {
    super("Telnyx could not receive the hosted voice continuation.");
    this.name = "TelnyxHostedVoiceContinuationError";
  }
}

export async function sendTelnyxHostedVoiceContinuation(input: {
  apiKey: string;
  callControlId: string;
  fetchImpl?: typeof fetch;
  message: string;
  requestId: string;
}) {
  const apiKey = z.string().trim().min(1).parse(input.apiKey);
  const callControlId = z
    .string()
    .trim()
    .min(1)
    .max(240)
    .parse(input.callControlId);
  const message = z.string().trim().min(1).max(8_000).parse(input.message);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${TELNYX_API_BASE_URL}/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_add_messages`,
      {
        body: JSON.stringify({
          command_id: deterministicUuid(input.requestId),
          messages: [{ content: message, role: "system" }],
          trigger_response: false,
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
  } catch {
    throw new TelnyxHostedVoiceContinuationError("provider_unavailable", true);
  }
  if (response.ok) return;
  if (response.status === 404 || response.status === 410) {
    throw new TelnyxHostedVoiceContinuationError("call_ended", false);
  }
  const retryable =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  throw new TelnyxHostedVoiceContinuationError(
    retryable ? "provider_unavailable" : "provider_rejected",
    retryable,
  );
}

function deterministicUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
