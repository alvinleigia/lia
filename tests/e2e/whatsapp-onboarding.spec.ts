import { expect, test } from "@playwright/test";
import {
  activateWhatsAppSignup,
  createWhatsAppSignupState,
  exchangeWhatsAppSignupCode,
  verifyWhatsAppAccount,
  verifyWhatsAppAppWebhook,
  verifyWhatsAppSignupState,
  type WhatsAppSignupSettings,
  whatsappSignupInputSchema,
} from "../../src/lib/whatsapp-embedded-signup";
import { parseWhatsAppSignupEvent } from "../../src/lib/whatsapp-signup-events";

const settings: WhatsAppSignupSettings = {
  appId: "123",
  appSecret: "test-secret-not-a-real-secret",
  configId: "456",
  apiVersion: "v24.0",
  verifyToken: "test-webhook-verification-token-only",
  webhookUrl: "https://lia.example.test/api/whatsapp/webhook",
};
const phone = {
  id: "789",
  display_phone_number: "+15550000000",
  verified_name: "Test Hotel",
  status: "CONNECTED",
  code_verification_status: "VERIFIED",
};
const account = {
  settings,
  accessToken: "private-test-token",
  businessAccountId: "456",
  phoneNumberId: "789",
  pin: "123456",
};

function metaMock(responses: Array<unknown | Response | Error>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("Unexpected Meta request");
    return next instanceof Response ? next : Response.json(next);
  };
  return { fetchImpl, requests };
}

test("signup state binds browser, user, project and expiry; malformed signatures fail closed", () => {
  const state = createWhatsAppSignupState(
    { projectId: 1, userId: 2 },
    settings.appSecret,
    1000,
  );
  const input = {
    state,
    cookie: state,
    projectId: 1,
    userId: 2,
    secret: settings.appSecret,
    now: 2000,
  };
  expect(verifyWhatsAppSignupState(input)).toBe(true);
  for (const changes of [
    { projectId: 3 },
    { userId: 3 },
    { cookie: undefined },
    { cookie: "other" },
    { now: 901000 },
  ]) {
    expect(verifyWhatsAppSignupState({ ...input, ...changes })).toBe(false);
  }
  const altered = `${state.split(".")[0]}.${"é".repeat(43)}`;
  expect(
    verifyWhatsAppSignupState({ ...input, state: altered, cookie: altered }),
  ).toBe(false);
});

test("only exact Meta origins and complete standard signup events are accepted", () => {
  const event = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: "456", phone_number_id: "789" },
  };
  expect(
    parseWhatsAppSignupEvent("https://www.facebook.com", JSON.stringify(event)),
  ).toEqual({
    kind: "finished",
    businessAccountId: "456",
    phoneNumberId: "789",
  });
  for (const origin of [
    "https://evilfacebook.com",
    "https://www.facebook.com.attacker.test",
    "http://www.facebook.com",
    "null",
  ]) {
    expect(parseWhatsAppSignupEvent(origin, event)).toBeNull();
  }
  expect(
    parseWhatsAppSignupEvent("https://web.facebook.com", {
      ...event,
      event: "CANCEL",
    }),
  ).toEqual({ kind: "cancelled" });
  expect(
    parseWhatsAppSignupEvent("https://www.facebook.com", {
      ...event,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    }),
  ).toEqual({ kind: "unsupported" });
  expect(
    parseWhatsAppSignupEvent("https://www.facebook.com", {
      ...event,
      data: {},
    }),
  ).toEqual({ kind: "incomplete" });
  expect(
    parseWhatsAppSignupEvent("https://www.facebook.com", "bad-json"),
  ).toBeNull();
});

test("signup inputs cannot inject Graph paths or omit the PIN", () => {
  const input = {
    projectId: 1,
    state: "x".repeat(40),
    code: "test-code",
    businessAccountId: "456",
    phoneNumberId: "789",
    pin: "123456",
  };
  expect(whatsappSignupInputSchema.safeParse(input).success).toBe(true);
  for (const changes of [
    { businessAccountId: "../other" },
    { projectId: -1 },
    { pin: "12345" },
    { code: "" },
  ]) {
    expect(
      whatsappSignupInputSchema.safeParse({ ...input, ...changes }).success,
    ).toBe(false);
  }
});

test("preflight verifies the exact deployment callback and messages subscription", async () => {
  const entry = {
    object: "whatsapp_business_account",
    callback_url: settings.webhookUrl,
    active: true,
    fields: [{ name: "messages" }],
  };
  await expect(
    verifyWhatsAppAppWebhook(settings, metaMock([{ data: [entry] }]).fetchImpl),
  ).resolves.toBeUndefined();
  for (const changes of [
    { callback_url: "https://staging.example.test/api/whatsapp/webhook" },
    { fields: [] },
    { active: false },
  ]) {
    await expect(
      verifyWhatsAppAppWebhook(
        settings,
        metaMock([{ data: [{ ...entry, ...changes }] }]).fetchImpl,
      ),
    ).rejects.toThrow("administrator attention");
  }
});

test("code exchange verifies app identity, permissions and expiration before use", async () => {
  const debug = {
    app_id: settings.appId,
    is_valid: true,
    scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    expires_at: 0,
  };
  const token = { access_token: "private-test-token" };
  await expect(
    exchangeWhatsAppSignupCode(
      settings,
      "test-code",
      metaMock([token, { data: debug }]).fetchImpl,
    ),
  ).resolves.toBe("private-test-token");
  for (const changes of [
    { app_id: "999" },
    { is_valid: false },
    { scopes: [] },
    { expires_at: 1 },
    { data_access_expires_at: 1 },
  ]) {
    await expect(
      exchangeWhatsAppSignupCode(
        settings,
        "test-code",
        metaMock([token, { data: { ...debug, ...changes } }]).fetchImpl,
      ),
    ).rejects.toThrow("valid WhatsApp permissions");
  }
});

test("reconnect skips registration, subscribes and verifies before completion", async () => {
  const mock = metaMock([
    { data: [phone] },
    { success: true },
    { data: [phone] },
  ]);
  await expect(
    activateWhatsAppSignup({ ...account, fetchImpl: mock.fetchImpl }),
  ).resolves.toEqual(phone);
  expect(mock.requests.map((entry) => new URL(entry.url).pathname)).toEqual([
    "/v24.0/456/phone_numbers",
    "/v24.0/456/subscribed_apps",
    "/v24.0/456/phone_numbers",
  ]);
  expect(
    mock.requests.every(
      (entry) =>
        entry.init?.redirect === "error" && entry.init?.cache === "no-store",
    ),
  ).toBe(true);
});

test("a verified new number is registered using the supplied security PIN", async () => {
  const mock = metaMock([
    { data: [{ ...phone, status: "PENDING" }] },
    { success: true },
    { success: true },
    { data: [phone] },
  ]);
  await activateWhatsAppSignup({
    ...account,
    pin: "987654",
    fetchImpl: mock.fetchImpl,
  });
  expect(JSON.parse(String(mock.requests[1].init?.body))).toEqual({
    messaging_product: "whatsapp",
    pin: "987654",
  });
});

test("an unrelated or unverified phone cannot trigger registration or subscription", async () => {
  for (const candidate of [
    { ...phone, id: "999" },
    { ...phone, status: "PENDING", code_verification_status: "NOT_VERIFIED" },
  ]) {
    const mock = metaMock([{ data: [candidate] }]);
    await expect(
      activateWhatsAppSignup({ ...account, fetchImpl: mock.fetchImpl }),
    ).rejects.toThrow();
    expect(mock.requests).toHaveLength(1);
  }
});

test("pagination stays on Graph and uses only the returned cursor", async () => {
  const mock = metaMock([
    {
      data: [],
      paging: { next: "https://attacker.test", cursors: { after: "cursor1" } },
    },
    { data: [phone] },
  ]);
  await verifyWhatsAppAccount({ ...account, fetchImpl: mock.fetchImpl });
  expect(mock.requests[1].url).toContain(
    "https://graph.facebook.com/v24.0/456/phone_numbers?",
  );
  expect(mock.requests[1].url).toContain("after=cursor1");
});

test("HTTP success without business success does not report a connected account", async () => {
  const mock = metaMock([{ data: [phone] }, { success: false }]);
  await expect(
    activateWhatsAppSignup({ ...account, fetchImpl: mock.fetchImpl }),
  ).rejects.toThrow("not enabled message delivery");
});

test("expired tokens have actionable errors and raw secrets never reach the caller", async () => {
  for (const response of [
    Response.json(
      { error: { code: 190, message: "secret-token" } },
      { status: 401 },
    ),
    new Error("secret-url"),
  ]) {
    const mock = metaMock([response]);
    try {
      await verifyWhatsAppAccount({ ...account, fetchImpl: mock.fetchImpl });
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).not.toContain("secret-");
      expect(String(error)).toMatch(/reconnect|try connecting again/);
    }
  }
});
