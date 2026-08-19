import { expect, test } from "@playwright/test";
import {
  checkReusableTemplateCompatibility,
  getReusableTemplateUpgradeGuidance,
  normalizeRegistryKey,
  parseReusableTemplatePayload,
  resolveReusableFields,
} from "../../src/lib/reuse-registry";

test.describe("reusable content registry", () => {
  test("normalizes reusable keys", () => {
    expect(normalizeRegistryKey(" Customer Email ")).toBe("customer_email");
    expect(normalizeRegistryKey("guestPhoneNumber")).toBe("guest_phone_number");
  });

  test("validates each reusable template kind", () => {
    expect(
      parseReusableTemplatePayload("task", { definition: { title: "Book" } }),
    ).toBeTruthy();
    expect(
      parseReusableTemplatePayload("field_set", {
        fields: [{ key: "email", type: "email" }],
      }),
    ).toBeTruthy();
    expect(
      parseReusableTemplatePayload("node", { step: { type: "message" } }),
    ).toBeTruthy();
    expect(
      parseReusableTemplatePayload("composed_content", {
        content: [{ type: "text", text: "Hello" }],
      }),
    ).toBeTruthy();
    expect(() =>
      parseReusableTemplatePayload("field_set", { fields: [] }),
    ).toThrow();
  });

  test("uses a project field instead of its company default", () => {
    const companyField = {
      fieldType: "text",
      key: "customer_email",
      projectId: null,
    } as const;
    const projectField = {
      fieldType: "email",
      key: "customer_email",
      projectId: 7,
    } as const;

    expect(resolveReusableFields([companyField, projectField])).toEqual([
      projectField,
    ]);
    expect(
      checkReusableTemplateCompatibility(
        { fields: [{ key: "customer_email", type: "email" }] },
        [companyField, projectField],
      ),
    ).toEqual({ compatible: true, errors: [] });
  });

  test("reports missing fields and incompatible upgrades", () => {
    const compatibility = checkReusableTemplateCompatibility(
      { fields: [{ key: "guest_phone", type: "phone" }] },
      [],
    );
    expect(compatibility.compatible).toBe(false);
    expect(compatibility.errors).toContain(
      "Field guest_phone is not registered in this scope.",
    );

    expect(
      getReusableTemplateUpgradeGuidance(
        { fields: [{ key: "guest_phone", type: "phone" }] },
        { fields: [{ key: "guest_phone", type: "text" }] },
      ),
    ).toMatchObject({ changed: ["guest_phone"], compatible: false });
  });
});
