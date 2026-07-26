import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskDefinitionV1Schema,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
} from "@/lib/conversation-contracts";

export const CONVERSATIONAL_TASK_TEMPLATE_KEYS = [
  "booking",
  "lead_capture",
  "support_intake",
  "custom",
] as const;

export type ConversationalTaskTemplateKey =
  (typeof CONVERSATIONAL_TASK_TEMPLATE_KEYS)[number];

export const CONVERSATIONAL_TASK_TEMPLATES = [
  {
    key: "booking",
    name: "Booking",
    description: "Collect a service, preferred schedule, and contact details.",
    defaultName: "Book a Service",
    defaultObjective:
      "Help visitors choose a service and submit an appointment request.",
  },
  {
    key: "lead_capture",
    name: "Lead Capture",
    description:
      "Qualify an enquiry and collect the visitor's contact details.",
    defaultName: "Qualify a Lead",
    defaultObjective:
      "Understand the visitor's enquiry and prepare it for follow-up.",
  },
  {
    key: "support_intake",
    name: "Support Intake",
    description:
      "Capture an issue, its urgency, and a reliable contact method.",
    defaultName: "Create a Support Request",
    defaultObjective:
      "Collect the information the support team needs to review an issue.",
  },
  {
    key: "custom",
    name: "Start Blank",
    description: "Create a task with no fields and add only what you need.",
    defaultName: "New Task",
    defaultObjective: "Help the visitor complete one clear business goal.",
  },
] as const satisfies ReadonlyArray<{
  key: ConversationalTaskTemplateKey;
  name: string;
  description: string;
  defaultName: string;
  defaultObjective: string;
}>;

type TaskField = ConversationalTaskDefinitionV1["fields"][number];
type TaskOutcome = ConversationalTaskDefinitionV1["outcomes"][number];

function field(
  createId: () => string,
  input: Pick<TaskField, "key" | "label" | "type"> & Partial<TaskField>,
): TaskField {
  return {
    id: createId(),
    key: input.key,
    label: input.label,
    type: input.type,
    cardinality: input.cardinality ?? "single",
    confirmation: input.confirmation ?? "when_changed",
    dependsOn: input.dependsOn ?? [],
    normalization: input.normalization ?? null,
    optionSource: input.optionSource ?? null,
    prompt: input.prompt ?? null,
    required: input.required ?? true,
    requiredWhen: input.requiredWhen ?? null,
    sensitivity: input.sensitivity ?? "standard",
    sourcePriority: input.sourcePriority ?? [
      "visitor",
      "profile",
      "project_resource",
      "tool",
    ],
    validation: input.validation ?? null,
  };
}

function outcome(
  createId: () => string,
  input: Omit<TaskOutcome, "id">,
): TaskOutcome {
  return { id: createId(), ...input };
}

function baseDefinition(
  createId: () => string,
): ConversationalTaskDefinitionV1 {
  return {
    ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
    contextVariables: [],
    fields: [],
    outcomes: [
      outcome(createId, {
        key: "completed",
        label: "Completed",
        type: "completed",
        condition: null,
        outputPort: "completed",
      }),
      outcome(createId, {
        key: "cancelled",
        label: "Cancelled",
        type: "cancelled",
        condition: null,
        outputPort: "cancelled",
      }),
    ],
    tools: [],
  };
}

function bookingDefinition(
  createId: () => string,
): ConversationalTaskDefinitionV1 {
  const definition = baseDefinition(createId);
  return {
    ...definition,
    fields: [
      field(createId, {
        key: "serviceCategoryId",
        label: "Service Category",
        type: "project_resource",
        prompt: "Which service category would you like?",
        optionSource: {
          kind: "project_resource",
          resourceType: "serviceCategory",
          collectionKey: null,
          filterByField: null,
        },
      }),
      field(createId, {
        key: "serviceId",
        label: "Service",
        type: "project_resource",
        prompt: "Which service would you like?",
        dependsOn: ["serviceCategoryId"],
        optionSource: {
          kind: "project_resource",
          resourceType: "service",
          collectionKey: null,
          filterByField: "serviceCategoryId",
        },
      }),
      field(createId, {
        key: "preferredDate",
        label: "Preferred Date",
        type: "date",
        prompt: "What date would you prefer?",
        dependsOn: ["serviceId"],
      }),
      field(createId, {
        key: "preferredTime",
        label: "Preferred Time",
        type: "time",
        prompt: "What time would you prefer?",
        dependsOn: ["preferredDate"],
      }),
      field(createId, {
        key: "guestName",
        label: "Guest Name",
        type: "text",
        prompt: "What name should we use for the request?",
        sensitivity: "personal",
      }),
      field(createId, {
        key: "guestEmail",
        label: "Guest Email",
        type: "email",
        prompt: "What email should we use for updates?",
        sensitivity: "personal",
      }),
      field(createId, {
        key: "guestPhone",
        label: "Guest Phone",
        type: "phone",
        prompt: "What phone number should the team use if needed?",
        normalization: "E.164",
        sensitivity: "personal",
      }),
    ],
    outcomes: [
      ...definition.outcomes,
      outcome(createId, {
        key: "handoff",
        label: "Needs Team Help",
        type: "handoff",
        condition: null,
        outputPort: "handoff",
      }),
      outcome(createId, {
        key: "failed",
        label: "Booking Failed",
        type: "failed",
        condition: null,
        outputPort: "failed",
      }),
    ],
  };
}

function leadCaptureDefinition(
  createId: () => string,
): ConversationalTaskDefinitionV1 {
  const definition = baseDefinition(createId);
  return {
    ...definition,
    fields: [
      field(createId, {
        key: "leadName",
        label: "Name",
        type: "text",
        prompt: "What name should the team use?",
        sensitivity: "personal",
      }),
      field(createId, {
        key: "leadEmail",
        label: "Email",
        type: "email",
        prompt: "What email should the team use to contact you?",
        sensitivity: "personal",
      }),
      field(createId, {
        key: "leadPhone",
        label: "Phone",
        type: "phone",
        prompt: "What phone number should the team use?",
        normalization: "E.164",
        required: false,
        sensitivity: "personal",
      }),
      field(createId, {
        key: "companyName",
        label: "Company",
        type: "text",
        prompt: "Which company are you contacting us from?",
        required: false,
      }),
      field(createId, {
        key: "enquiry",
        label: "Enquiry",
        type: "text",
        prompt: "What would you like help with?",
      }),
    ],
    outcomes: [
      ...definition.outcomes,
      outcome(createId, {
        key: "handoff",
        label: "Talk to Team",
        type: "handoff",
        condition: null,
        outputPort: "handoff",
      }),
    ],
  };
}

function supportIntakeDefinition(
  createId: () => string,
): ConversationalTaskDefinitionV1 {
  const definition = baseDefinition(createId);
  return {
    ...definition,
    fields: [
      field(createId, {
        key: "customerEmail",
        label: "Contact Email",
        type: "email",
        prompt: "What email should support use to contact you?",
        sensitivity: "personal",
      }),
      field(createId, {
        key: "issueSummary",
        label: "Issue",
        type: "text",
        prompt: "Please briefly describe the issue.",
        validation: "minLength:10",
      }),
      field(createId, {
        key: "urgency",
        label: "Urgency",
        type: "enum",
        prompt: "How urgent is this issue?",
        optionSource: {
          kind: "static",
          options: [
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "urgent", label: "Urgent" },
          ],
        },
      }),
      field(createId, {
        key: "attachment",
        label: "Attachment",
        type: "media",
        prompt: "Would you like to attach a screenshot or file?",
        required: false,
      }),
    ],
    outcomes: [
      ...definition.outcomes,
      outcome(createId, {
        key: "handoff",
        label: "Urgent Handoff",
        type: "handoff",
        condition: "urgency == urgent",
        outputPort: "urgent_handoff",
      }),
    ],
  };
}

export function createConversationalTaskDefinitionFromTemplate(
  templateKey: ConversationalTaskTemplateKey,
  createId: () => string = () => crypto.randomUUID(),
) {
  const definition =
    templateKey === "booking"
      ? bookingDefinition(createId)
      : templateKey === "lead_capture"
        ? leadCaptureDefinition(createId)
        : templateKey === "support_intake"
          ? supportIntakeDefinition(createId)
          : baseDefinition(createId);

  return conversationalTaskDefinitionV1Schema.parse(definition);
}

export function getConversationalTaskTemplate(
  templateKey: ConversationalTaskTemplateKey,
) {
  return CONVERSATIONAL_TASK_TEMPLATES.find(
    (template) => template.key === templateKey,
  );
}
