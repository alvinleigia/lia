import { expect, test } from "@playwright/test";
import { buildActionStepSettings } from "../../src/lib/action-step-settings";

test("partial step updates preserve settings they do not manage", () => {
  const contentBlocks = [
    {
      id: "message-1",
      text: "Welcome",
      type: "text",
    },
  ];

  const settings = buildActionStepSettings({
    contactTagNames: "qualified",
    existingSettings: {
      contentBlocks,
      futureCapability: { enabled: true },
      requiredMessage: "Please provide this detail.",
      validationMinLength: 2,
    },
    stepType: "add_tag",
  });

  expect(settings).toMatchObject({
    contactTagNames: "qualified",
    contentBlocks,
    futureCapability: { enabled: true },
    requiredMessage: "Please provide this detail.",
    validationMinLength: 2,
  });
});

test("managed blank settings are removed without deleting unknown settings", () => {
  const settings = buildActionStepSettings({
    contactTagNames: "",
    existingSettings: {
      contentBlocks: [{ id: "message-1", text: "Welcome", type: "text" }],
      contactTagNames: "qualified",
      requiredMessage: "Please provide this detail.",
      validationMinLength: 2,
    },
    requiredMessage: "",
    stepType: "collect_input",
    validationMinLength: undefined,
  });

  expect(settings).not.toHaveProperty("contactTagNames");
  expect(settings).not.toHaveProperty("requiredMessage");
  expect(settings).not.toHaveProperty("validationMinLength");
  expect(settings).toHaveProperty("contentBlocks");
});

test("changing step families removes managed incompatible settings", () => {
  const settings = buildActionStepSettings({
    existingSettings: {
      contentBlocks: [{ id: "message-1", text: "Welcome", type: "text" }],
      whatsappTemplateBody: "Hello {{1}}",
      whatsappTemplateCategory: "utility",
      whatsappTemplateName: "welcome",
      whatsappTemplateStatus: "approved",
    },
    stepType: "message",
    whatsappTemplateBody: undefined,
    whatsappTemplateCategory: undefined,
    whatsappTemplateLanguage: undefined,
    whatsappTemplateName: undefined,
    whatsappTemplateStatus: undefined,
    whatsappTemplateVariables: undefined,
  });

  expect(settings).not.toHaveProperty("whatsappTemplateBody");
  expect(settings).not.toHaveProperty("whatsappTemplateCategory");
  expect(settings).not.toHaveProperty("whatsappTemplateName");
  expect(settings).not.toHaveProperty("whatsappTemplateStatus");
  expect(settings).toHaveProperty("contentBlocks");
});

test("template settings retain typed body variable mappings", () => {
  const settings = buildActionStepSettings({
    existingSettings: {},
    stepType: "template_message",
    whatsappTemplateBody: "Hello {{1}} on {{2}}",
    whatsappTemplateCategory: "utility",
    whatsappTemplateLanguage: "en_US",
    whatsappTemplateName: "booking",
    whatsappTemplateStatus: "approved",
    whatsappTemplateVariables: "{{guestName}}\nTomorrow",
  });

  expect(settings.whatsappTemplateComponents).toEqual([
    {
      parameters: [
        { index: 1, source: "field", value: "guestName" },
        { index: 2, source: "literal", value: "Tomorrow" },
      ],
      text: "Hello {{1}} on {{2}}",
      type: "body",
    },
  ]);
});
