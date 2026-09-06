import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HOSTED_VOICE_TOOL_PHASES } from "@/lib/hosted-voice-tool-contract";

export const HOSTED_VOICE_NO_CALL_VERIFICATION_HEADER =
  "X-Lia-No-Call-Verification";

const NO_CALL_VERIFICATION_TTL_MS = 5 * 60 * 1000;

const hostedVoiceNoCallVerificationPayloadSchema = z.object({
  expiresAt: z.number().int().positive(),
  nonce: z.string().uuid(),
  phase: z.enum(HOSTED_VOICE_TOOL_PHASES).exclude(["commit"]),
  purpose: z.literal("hosted_voice_no_call_verification"),
  toolId: z.string().trim().min(1).max(120),
});

const hostedVoiceAuthenticationErrorSchema = z
  .object({
    error: z.literal("unauthorized"),
    message: z.string(),
  })
  .passthrough();

export function verifyHostedVoiceIntegrationSecretFreshness(input: {
  bindingUpdatedAt: Date;
  integrationSecretUpdatedAt: string;
}) {
  const integrationSecretUpdatedAt = Date.parse(
    input.integrationSecretUpdatedAt,
  );
  if (
    !Number.isFinite(integrationSecretUpdatedAt) ||
    integrationSecretUpdatedAt < input.bindingUpdatedAt.getTime()
  ) {
    throw new Error(
      "Update the Telnyx Integration Secret with the current binding credential before pushing tools.",
    );
  }

  return { status: "current" as const };
}

export async function verifyHostedVoiceToolEndpoint(input: {
  fetchImpl?: typeof fetch;
  url: string;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      body: "{}",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new Error(
      "The public hosted voice tool endpoint could not be reached.",
    );
  }

  const payload = await response.json().catch(() => null);
  if (
    response.status !== 401 ||
    !hostedVoiceAuthenticationErrorSchema.safeParse(payload).success
  ) {
    throw new Error(
      "The public hosted voice tool endpoint did not reach Lia bearer authentication.",
    );
  }

  return { status: "ready" as const };
}

export function createHostedVoiceNoCallVerificationToken(input: {
  now?: Date;
  phase: "prepare" | "read";
  secret: string;
  toolId: string;
}) {
  const now = input.now ?? new Date();
  const payload = hostedVoiceNoCallVerificationPayloadSchema.parse({
    expiresAt: now.getTime() + NO_CALL_VERIFICATION_TTL_MS,
    nonce: randomUUID(),
    phase: input.phase,
    purpose: "hosted_voice_no_call_verification",
    toolId: input.toolId,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac(
    "sha256",
    requireNoCallVerificationSecret(input.secret),
  )
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyHostedVoiceNoCallVerificationToken(input: {
  now?: Date;
  phase: (typeof HOSTED_VOICE_TOOL_PHASES)[number];
  secret: string;
  token: string | null;
  toolId: string;
}) {
  if (!input.token || input.secret.trim().length < 32) return null;
  const [encoded, suppliedSignature, extra] = input.token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = createHmac("sha256", input.secret)
    .update(encoded)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const payload = hostedVoiceNoCallVerificationPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    const now = input.now ?? new Date();
    if (
      !payload.success ||
      payload.data.expiresAt <= now.getTime() ||
      payload.data.phase !== input.phase ||
      payload.data.toolId !== input.toolId
    ) {
      return null;
    }
    return `lia-no-call:${payload.data.nonce}`;
  } catch {
    return null;
  }
}

function requireNoCallVerificationSecret(secret: string) {
  if (secret.trim().length < 32) {
    throw new Error(
      "Hosted voice no-call verification requires a 32-character secret.",
    );
  }
  return secret;
}
