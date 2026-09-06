import { z } from "zod";

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
