import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const metaId = z.string().regex(/^\d{1,40}$/);
export const whatsappSignupInputSchema = z.object({
  projectId: z.number().int().positive(),
  state: z.string().min(32).max(2000),
  code: z.string().min(1).max(4096),
  businessAccountId: metaId,
  phoneNumberId: metaId,
  pin: z.string().regex(/^\d{6}$/),
});

const settingsSchema = z.object({
  appId: metaId,
  appSecret: z.string().min(16),
  configId: metaId,
  apiVersion: z.string().regex(/^v\d+\.0$/),
  verifyToken: z.string().min(32),
  webhookUrl: z.url().refine((value) => value.startsWith("https://")),
});
export type WhatsAppSignupSettings = z.infer<typeof settingsSchema>;

export function getWhatsAppSignupSettings() {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const result = settingsSchema.safeParse({
    appId: process.env.WHATSAPP_META_APP_ID,
    appSecret: process.env.WHATSAPP_META_APP_SECRET,
    configId: process.env.WHATSAPP_SIGNUP_CONFIG_ID,
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    webhookUrl: `${baseUrl.replace(/\/$/, "")}/api/whatsapp/webhook`,
  });
  return result.success ? result.data : null;
}

export function matchesPlatformWhatsAppVerifyToken(supplied: string) {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected || expected.length < 32) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const stateSchema = z.object({
  projectId: z.number().int().positive(),
  userId: z.number().int().positive(),
  expiresAt: z.number(),
  nonce: z.string().uuid(),
});
export const WHATSAPP_SIGNUP_TTL_SECONDS = 15 * 60;

export function createWhatsAppSignupState(
  scope: { projectId: number; userId: number },
  secret: string,
  now = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify({
      ...scope,
      expiresAt: now + WHATSAPP_SIGNUP_TTL_SECONDS * 1000,
      nonce: randomUUID(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`whatsapp-signup:${body}`)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyWhatsAppSignupState(input: {
  state: string;
  cookie: string | undefined;
  projectId: number;
  userId: number;
  secret: string;
  now?: number;
}) {
  if (!input.cookie || input.cookie !== input.state) return false;
  const [body, signature, extra] = input.state.split(".");
  if (!body || !signature || extra) return false;
  const expected = createHmac("sha256", input.secret)
    .update(`whatsapp-signup:${body}`)
    .digest("base64url");
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  )
    return false;
  try {
    const parsed = stateSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString()),
    );
    return (
      parsed.success &&
      parsed.data.userId === input.userId &&
      parsed.data.projectId === input.projectId &&
      parsed.data.expiresAt > (input.now ?? Date.now())
    );
  } catch {
    return false;
  }
}

export class WhatsAppSignupError extends Error {}

// Never return Graph's raw errors: they can contain tokens, IDs or request URLs.
async function graphRequest(
  settings: Pick<WhatsAppSignupSettings, "apiVersion">,
  path: string,
  token: string | null,
  body: Record<string, string> | undefined,
  fetchImpl: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetchImpl(
      `https://graph.facebook.com/${settings.apiVersion}/${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      },
    );
  } catch {
    throw new WhatsAppSignupError(
      "Meta could not be reached. Please try connecting again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    if (data?.error?.code === 190) {
      throw new WhatsAppSignupError(
        "Meta authorization expired or was revoked. Please reconnect WhatsApp.",
      );
    }
    throw new WhatsAppSignupError(
      "Meta could not complete this step. Check your business permissions and number setup, then reconnect.",
    );
  }
  return data as unknown;
}

export async function verifyWhatsAppAppWebhook(
  settings: WhatsAppSignupSettings,
  fetchImpl = fetch,
) {
  const result = await graphRequest(
    settings,
    `${settings.appId}/subscriptions`,
    `${settings.appId}|${settings.appSecret}`,
    undefined,
    fetchImpl,
  );
  const parsed = z
    .object({
      data: z.array(
        z.object({
          object: z.string(),
          callback_url: z.string(),
          active: z.boolean().optional(),
          fields: z.array(z.object({ name: z.string() })),
        }),
      ),
    })
    .safeParse(result);
  if (
    !parsed.success ||
    !parsed.data.data.some(
      (entry) =>
        entry.object === "whatsapp_business_account" &&
        entry.callback_url === settings.webhookUrl &&
        entry.active !== false &&
        entry.fields.some((field) => field.name === "messages"),
    )
  ) {
    throw new WhatsAppSignupError(
      "Lia's WhatsApp webhook setup needs administrator attention before you can connect.",
    );
  }
}

const phoneSchema = z.object({
  id: metaId,
  display_phone_number: z.string(),
  verified_name: z.string().optional(),
  status: z.string(),
  code_verification_status: z.string().optional(),
});

export async function verifyWhatsAppAccount(input: {
  settings: Pick<WhatsAppSignupSettings, "apiVersion">;
  accessToken: string;
  businessAccountId: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  // Enumerate within the authorized WABA; a client-supplied phone ID alone proves nothing.
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({
      fields:
        "id,display_phone_number,verified_name,status,code_verification_status",
      limit: "100",
    });
    if (after) query.set("after", after);
    const raw = await graphRequest(
      input.settings,
      `${input.businessAccountId}/phone_numbers?${query}`,
      input.accessToken,
      undefined,
      fetchImpl,
    );
    const result = z
      .object({
        data: z.array(phoneSchema),
        paging: z
          .object({
            next: z.string().optional(),
            cursors: z.object({ after: z.string().optional() }).optional(),
          })
          .optional(),
      })
      .safeParse(raw);
    if (!result.success) break;
    const phone = result.data.data.find(
      (entry) => entry.id === input.phoneNumberId,
    );
    if (phone) return phone;
    if (!result.data.paging?.next || !result.data.paging.cursors?.after) break;
    after = result.data.paging.cursors.after;
  }
  throw new WhatsAppSignupError(
    "The selected number could not be verified in your WhatsApp business account. Please reconnect and select the correct number.",
  );
}

export async function exchangeWhatsAppSignupCode(
  settings: WhatsAppSignupSettings,
  code: string,
  fetchImpl = fetch,
) {
  const query = new URLSearchParams({
    client_id: settings.appId,
    client_secret: settings.appSecret,
    code,
  });
  const raw = await graphRequest(
    settings,
    `oauth/access_token?${query}`,
    null,
    undefined,
    fetchImpl,
  );
  const token = z.object({ access_token: z.string().min(1) }).safeParse(raw);
  if (!token.success)
    throw new WhatsAppSignupError(
      "Meta did not return authorization. Please reconnect.",
    );
  const debugQuery = new URLSearchParams({
    input_token: token.data.access_token,
  });
  const debug = await graphRequest(
    settings,
    `debug_token?${debugQuery}`,
    `${settings.appId}|${settings.appSecret}`,
    undefined,
    fetchImpl,
  );
  const parsed = z
    .object({
      data: z.object({
        app_id: z.string(),
        is_valid: z.boolean(),
        scopes: z.array(z.string()),
        expires_at: z.number().optional(),
        data_access_expires_at: z.number().optional(),
      }),
    })
    .safeParse(debug);
  const now = Date.now() / 1000;
  if (
    !parsed.success ||
    !parsed.data.data.is_valid ||
    parsed.data.data.app_id !== settings.appId ||
    !["whatsapp_business_management", "whatsapp_business_messaging"].every(
      (scope) => parsed.data.data.scopes.includes(scope),
    ) ||
    [parsed.data.data.expires_at, parsed.data.data.data_access_expires_at].some(
      (expiry) => expiry && expiry <= now,
    )
  ) {
    throw new WhatsAppSignupError(
      "Meta did not grant valid WhatsApp permissions to Lia. Please reconnect and approve the requested access.",
    );
  }
  return token.data.access_token;
}

export async function activateWhatsAppSignup(input: {
  settings: WhatsAppSignupSettings;
  accessToken: string;
  businessAccountId: string;
  phoneNumberId: string;
  pin: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const phone = await verifyWhatsAppAccount(input);
  if (phone.status !== "CONNECTED") {
    if (phone.code_verification_status !== "VERIFIED") {
      throw new WhatsAppSignupError(
        "Verify your phone number in Meta before completing the connection.",
      );
    }
    const registration = await graphRequest(
      input.settings,
      `${input.phoneNumberId}/register`,
      input.accessToken,
      { messaging_product: "whatsapp", pin: input.pin },
      fetchImpl,
    );
    if (
      !z.object({ success: z.literal(true) }).safeParse(registration).success
    ) {
      throw new WhatsAppSignupError(
        "Meta has not completed number registration. Please check the number in WhatsApp Manager.",
      );
    }
  }
  const subscription = await graphRequest(
    input.settings,
    `${input.businessAccountId}/subscribed_apps`,
    input.accessToken,
    {},
    fetchImpl,
  );
  if (!z.object({ success: z.literal(true) }).safeParse(subscription).success) {
    throw new WhatsAppSignupError(
      "Meta has not enabled message delivery to Lia. Please reconnect.",
    );
  }
  const checked = await verifyWhatsAppAccount(input);
  if (checked.status !== "CONNECTED") {
    throw new WhatsAppSignupError(
      "Meta is still preparing your number. Please wait a moment and reconnect.",
    );
  }
  return checked;
}
