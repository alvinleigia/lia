import { expect, test } from "@playwright/test";
import { getDurableRetryDelayMs } from "../../src/lib/durable-jobs";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "../../src/lib/encrypted-secrets";
import {
  normalizeTraceId,
  resolveTraceId,
} from "../../src/lib/execution-trace";
import {
  getFlowWaitAvailableAt,
  getFlowWaitDurationMs,
} from "../../src/lib/flow-wait";
import { prepareProviderConfig } from "../../src/lib/provider-secrets";

test.describe("durable execution contracts", () => {
  test("rejects unauthenticated durable worker requests", async ({
    request,
  }) => {
    const response = await request.post("/api/durable/process-next");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  test("uses deterministic capped exponential retry delays", () => {
    const first = getDurableRetryDelayMs({
      attempt: 1,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });
    const second = getDurableRetryDelayMs({
      attempt: 2,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });
    const capped = getDurableRetryDelayMs({
      attempt: 20,
      baseDelayMs: 1_000,
      jitterKey: "project:1:job:one",
      maxDelayMs: 8_000,
    });

    expect(first).toBeGreaterThanOrEqual(800);
    expect(first).toBeLessThanOrEqual(1_200);
    expect(second).toBeGreaterThanOrEqual(1_600);
    expect(second).toBeLessThanOrEqual(2_400);
    expect(capped).toBeGreaterThanOrEqual(6_400);
    expect(capped).toBeLessThanOrEqual(9_600);
    expect(
      getDurableRetryDelayMs({
        attempt: 2,
        baseDelayMs: 1_000,
        jitterKey: "project:1:job:one",
        maxDelayMs: 8_000,
      }),
    ).toBe(second);
  });

  test("normalizes wait durations and caps them at thirty days", () => {
    expect(getFlowWaitDurationMs({})).toBe(60_000);
    expect(getFlowWaitDurationMs({ waitAmount: 15, waitUnit: "seconds" })).toBe(
      15_000,
    );
    expect(getFlowWaitDurationMs({ waitAmount: 90, waitUnit: "days" })).toBe(
      30 * 24 * 60 * 60_000,
    );

    const now = new Date("2026-07-21T10:00:00.000Z");
    expect(
      getFlowWaitAvailableAt(
        { waitAmount: 2, waitUnit: "hours" },
        now,
      ).toISOString(),
    ).toBe("2026-07-21T12:00:00.000Z");
  });

  test("accepts safe incoming trace ids and replaces invalid values", () => {
    expect(normalizeTraceId("trace:project-194.request_1")).toBe(
      "trace:project-194.request_1",
    );
    expect(normalizeTraceId("short")).toBeNull();
    expect(normalizeTraceId("trace id with spaces")).toBeNull();
    expect(resolveTraceId("trace:project-194.request_1")).toBe(
      "trace:project-194.request_1",
    );
    expect(resolveTraceId("bad")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("encrypts credentials with authenticated versioned envelopes", () => {
    const encrypted = encryptSecretValue("test-provider-secret");

    expect(JSON.stringify(encrypted)).not.toContain("test-provider-secret");
    expect(decryptSecretValue(encrypted)).toBe("test-provider-secret");

    const tampered = structuredClone(encrypted);
    tampered.$liaEncryptedSecret.ciphertext =
      Buffer.from("tampered").toString("base64");
    expect(() => decryptSecretValue(tampered)).toThrow();
  });

  test("replaces nested provider credentials with secret references", () => {
    const prepared = prepareProviderConfig({
      accessToken: "meta-access-token",
      datasetId: "dataset-123",
      headers: {
        Authorization: "Bearer private-value",
        "Content-Type": "application/json",
        "x-api-key": "private-api-key",
      },
      url: "https://example.test/webhook",
    });
    const serializedConfig = JSON.stringify(prepared.config);

    expect(prepared.secrets.map((secret) => secret.secretName)).toEqual([
      "accessToken",
      "headers.Authorization",
      "headers.x-api-key",
    ]);
    expect(serializedConfig).not.toContain("meta-access-token");
    expect(serializedConfig).not.toContain("private-value");
    expect(serializedConfig).not.toContain("private-api-key");
    expect(serializedConfig).toContain("dataset-123");
    expect(serializedConfig).toContain("application/json");
  });
});
