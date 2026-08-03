import { expect, test } from "@playwright/test";
import { buildWhatsAppTemplateBodyComponent } from "@/lib/whatsapp-template-metadata";

test("builds typed field and literal template variable mappings", () => {
  expect(
    buildWhatsAppTemplateBodyComponent(
      "Hello {{1}}, your booking is on {{2}}.",
      ["{{guestName}}", "Tomorrow"],
    ),
  ).toEqual({
    parameters: [
      { index: 1, source: "field", value: "guestName" },
      { index: 2, source: "literal", value: "Tomorrow" },
    ],
    text: "Hello {{1}}, your booking is on {{2}}.",
    type: "body",
  });
});
