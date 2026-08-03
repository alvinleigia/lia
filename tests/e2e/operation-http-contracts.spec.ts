import { expect, test } from "@playwright/test";
import {
  formatOperationOutcomeLabel,
  getOperationOutcomeKeys,
  isOperationOutcomeKey,
} from "../../src/lib/operation-contracts";
import {
  buildWebhookRequest,
  getOperationResultOutcome,
  getSanitizedOperationAttemptPreview,
} from "../../src/lib/operations";

function getOutcome(input: {
  customStatusCodes?: number[];
  errorKind?: string;
  status?: number;
  attemptStatus?: "completed" | "failed" | "outcome_unknown";
}) {
  return getOperationResultOutcome({
    attempt: {
      responsePayload: {
        ...(input.errorKind ? { errorKind: input.errorKind } : {}),
        response: input.status === undefined ? {} : { status: input.status },
      },
      status: input.attemptStatus ?? "failed",
    } as never,
    operation: {
      settings: { customStatusCodes: input.customStatusCodes ?? [] },
    } as never,
  });
}

test.describe("HTTP operation contracts", () => {
  test("builds method-aware requests with friendly query and header values", () => {
    const getRequest = buildWebhookRequest({
      config: {
        headers: { "x-project": "194" },
        method: "GET",
        queryParameters: { include: "services", page: "2" },
        url: "https://example.test/catalog?locale=en",
      },
      idempotencyKey: "preview-1",
      payload: { ignored: true },
    });

    expect(getRequest.method).toBe("GET");
    expect(getRequest.body).toBeUndefined();
    expect(getRequest.headers).not.toHaveProperty("content-type");
    expect(getRequest.headers).toMatchObject({ "x-project": "194" });
    expect(Object.fromEntries(new URL(getRequest.url).searchParams)).toEqual({
      include: "services",
      locale: "en",
      page: "2",
    });

    const patchRequest = buildWebhookRequest({
      config: { method: "PATCH", url: "https://example.test/bookings/1" },
      idempotencyKey: "preview-2",
      payload: { status: "confirmed" },
    });

    expect(patchRequest.method).toBe("PATCH");
    expect(patchRequest.body).toBe('{"status":"confirmed"}');
    expect(patchRequest.headers["content-type"]).toBe("application/json");
  });

  test("classifies standard and custom result outputs", () => {
    expect(getOutcome({ status: 201, attemptStatus: "completed" })).toBe(
      "success",
    );
    expect(getOutcome({ status: 422 })).toBe("client_error");
    expect(getOutcome({ status: 503 })).toBe("server_error");
    expect(getOutcome({ errorKind: "timeout" })).toBe("timeout");
    expect(getOutcome({ errorKind: "network_failure" })).toBe(
      "network_failure",
    );
    expect(getOutcome({ customStatusCodes: [409], status: 409 })).toBe(
      "status_409",
    );
  });

  test("exposes only valid route keys and sanitizes nested response secrets", () => {
    expect(
      getOperationOutcomeKeys({ customStatusCodes: [409, 503, 99] }),
    ).toEqual([
      "success",
      "client_error",
      "server_error",
      "timeout",
      "network_failure",
      "status_409",
      "status_503",
    ]);
    expect(isOperationOutcomeKey("status_409")).toBe(true);
    expect(isOperationOutcomeKey("status_999")).toBe(false);
    expect(formatOperationOutcomeLabel("network_failure")).toBe(
      "Network failure",
    );

    const preview = getSanitizedOperationAttemptPreview({
      attempt: {
        responsePayload: {
          response: {
            body: {
              bookingId: "B-1",
              nested: { accessToken: "private", safe: "visible" },
            },
            status: 200,
            statusText: "OK",
          },
        },
        status: "completed",
      } as never,
      operation: { settings: {} } as never,
    });

    expect(preview).toEqual({
      body: {
        bookingId: "B-1",
        nested: { accessToken: "[REDACTED]", safe: "visible" },
      },
      outcome: "success",
      status: 200,
      statusText: "OK",
    });
  });
});
