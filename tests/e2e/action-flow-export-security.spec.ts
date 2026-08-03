import { expect, test } from "@playwright/test";
import { sanitizeActionFlowExportValue } from "../../src/lib/action-flow-export";
import {
  listProviderSecretReferenceNames,
  prepareProviderConfig,
} from "../../src/lib/provider-secrets";

test("flow export diagnostics redact nested credentials", () => {
  expect(
    sanitizeActionFlowExportValue({
      authorization: "Bearer private",
      headers: {
        "x-api-key": "secret-key",
        "x-project": "194",
      },
      nested: [{ accessToken: "token-value", result: "safe" }],
    }),
  ).toEqual({
    authorization: "[REDACTED]",
    headers: {
      "x-api-key": "[REDACTED]",
      "x-project": "194",
    },
    nested: [{ accessToken: "[REDACTED]", result: "safe" }],
  });
});

test("friendly API headers move credentials into encrypted secret records", () => {
  const prepared = prepareProviderConfig({
    headers: {
      Authorization: "Bearer private",
      "x-api-key": "secret-key",
      "x-project": "194",
    },
  });

  expect(JSON.stringify(prepared.config)).not.toContain("Bearer private");
  expect(JSON.stringify(prepared.config)).not.toContain("secret-key");
  expect(listProviderSecretReferenceNames(prepared.config)).toEqual([
    "headers.Authorization",
    "headers.x-api-key",
  ]);
  expect(prepared.secrets).toHaveLength(2);
  expect(prepared.config).toMatchObject({
    headers: { "x-project": "194" },
  });
});
