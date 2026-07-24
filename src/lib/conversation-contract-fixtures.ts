import {
  type ConversationalTaskDefinitionV1,
  DEFAULT_CONVERSATION_PROJECT_POLICY,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
} from "@/lib/conversation-contracts";

const fieldDefaults: Pick<
  ConversationalTaskDefinitionV1["fields"][number],
  | "confirmation"
  | "dependsOn"
  | "normalization"
  | "required"
  | "requiredWhen"
  | "sensitivity"
  | "sourcePriority"
  | "validation"
> = {
  confirmation: "when_changed",
  dependsOn: [],
  normalization: null,
  required: true,
  requiredWhen: null,
  sensitivity: "standard",
  sourcePriority: ["visitor", "profile", "project_resource", "tool"],
  validation: null,
};

export const REFERENCE_BOOKING_PROJECT_POLICY = {
  ...DEFAULT_CONVERSATION_PROJECT_POLICY,
  assistant: {
    ...DEFAULT_CONVERSATION_PROJECT_POLICY.assistant,
    baseInstructions:
      "Help visitors complete service bookings. Ask only for missing information and confirm before any write operation.",
    language: "English",
  },
};

export const REFERENCE_BOOKING_TASK_DEFINITION: ConversationalTaskDefinitionV1 =
  {
    ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
    contextVariables: [
      {
        key: "lia_timezone",
        type: "text",
        source: "system",
        defaultValue: null,
        sensitivity: "standard",
        expiresAfterMinutes: null,
        modelVisible: true,
        toolVisible: true,
      },
    ],
    fieldTransferWhitelist: ["guestName", "guestEmail", "guestPhone"].map(
      (fieldKey) => ({
        fieldKey,
        allowedSources: ["visitor", "profile"] as Array<"visitor" | "profile">,
        minimumValidationState: "valid" as const,
        maximumAgeMinutes: 1440,
        allowSensitive: true,
        requireProvenance: true,
      }),
    ),
    fields: [
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000001",
        key: "serviceCategoryId",
        label: "Service Category",
        type: "project_resource",
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000002",
        key: "serviceId",
        label: "Service",
        type: "project_resource",
        dependsOn: ["serviceCategoryId"],
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000003",
        key: "preferredDate",
        label: "Preferred Date",
        type: "date",
        dependsOn: ["serviceId"],
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000004",
        key: "preferredTime",
        label: "Preferred Time",
        type: "time",
        dependsOn: ["preferredDate"],
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000005",
        key: "guestName",
        label: "Guest Name",
        type: "text",
        sensitivity: "personal",
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000006",
        key: "guestEmail",
        label: "Guest Email",
        type: "email",
        sensitivity: "personal",
      },
      {
        ...fieldDefaults,
        id: "10000000-0000-4000-8000-000000000007",
        key: "guestPhone",
        label: "Guest Phone",
        type: "phone",
        sensitivity: "personal",
        normalization: "E.164",
      },
    ],
    outcomes: [
      ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION.outcomes,
      {
        id: "10000000-0000-4000-8000-000000000008",
        key: "handoff",
        label: "Needs Team Help",
        type: "handoff",
        condition: null,
        outputPort: "handoff",
      },
      {
        id: "10000000-0000-4000-8000-000000000009",
        key: "failed",
        label: "Booking Failed",
        type: "failed",
        condition: null,
        outputPort: "failed",
      },
    ],
    taskPolicy: {
      fallbackMessage:
        "I could not complete that booking request. Let me connect you with the team.",
      handoffMessage: "I will connect you with the booking team.",
      language: "English",
      responseLength: "short",
    },
  };
