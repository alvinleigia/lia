import {
  ACTION_STEP_TYPES,
  type ActionStepType,
} from "@/lib/action-flow-constants";

export const FLOW_COMPONENT_GROUPS = ["message", "action"] as const;
export const FLOW_COMPONENT_STATUSES = ["enabled", "planned"] as const;
export const FLOW_COMPONENT_CHANNELS = [
  "project_chat",
  "widget",
  "whatsapp",
  "future",
] as const;

export type FlowComponentGroup = (typeof FLOW_COMPONENT_GROUPS)[number];
export type FlowComponentStatus = (typeof FLOW_COMPONENT_STATUSES)[number];
export type FlowComponentChannel = (typeof FLOW_COMPONENT_CHANNELS)[number];

export type FlowComponentDefinition = {
  channels: readonly FlowComponentChannel[];
  color: string;
  description: string;
  group: FlowComponentGroup;
  key: string;
  label: string;
  status: FlowComponentStatus;
  stepType?: ActionStepType;
};

export type StepFlowComponentDefinition = FlowComponentDefinition & {
  stepType: ActionStepType;
};

const CURRENT_STEP_COMPONENTS: readonly FlowComponentDefinition[] = [
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#525252",
    description: "Send a text message before continuing the flow.",
    group: "message",
    key: "message",
    label: "Message",
    status: "enabled",
    stepType: "message",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Ask a free-form question and save the answer.",
    group: "action",
    key: "ask_question",
    label: "Ask Question",
    status: "enabled",
    stepType: "collect_input",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#2563eb",
    description: "Ask the user to choose from configured options.",
    group: "message",
    key: "choice",
    label: "Choice",
    status: "enabled",
    stepType: "choice",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0891b2",
    description: "Ask for a calendar date.",
    group: "action",
    key: "ask_date",
    label: "Ask Date",
    status: "enabled",
    stepType: "date",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0891b2",
    description: "Ask for a start and end date.",
    group: "action",
    key: "ask_date_range",
    label: "Ask Date Range",
    status: "enabled",
    stepType: "date_range",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0d9488",
    description: "Ask for a structured address.",
    group: "action",
    key: "ask_address",
    label: "Ask Address",
    status: "enabled",
    stepType: "address",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0891b2",
    description: "Ask for a time.",
    group: "action",
    key: "ask_time",
    label: "Ask Time",
    status: "enabled",
    stepType: "time",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Ask for a numeric value.",
    group: "action",
    key: "ask_number",
    label: "Ask Number",
    status: "enabled",
    stepType: "number",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Ask for an email address.",
    group: "action",
    key: "ask_email",
    label: "Ask Email",
    status: "enabled",
    stepType: "email",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Ask for a phone number.",
    group: "action",
    key: "ask_phone",
    label: "Ask Phone",
    status: "enabled",
    stepType: "phone",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0d9488",
    description: "Ask for location details.",
    group: "action",
    key: "ask_location",
    label: "Ask Location",
    status: "enabled",
    stepType: "location",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#ca8a04",
    description: "Ask for a media or file upload.",
    group: "action",
    key: "ask_media",
    label: "Ask Media",
    status: "enabled",
    stepType: "file_upload",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#0d9488",
    description: "Send an image, video, audio, or file.",
    group: "message",
    key: "media",
    label: "Media",
    status: "enabled",
    stepType: "media",
  },
  {
    channels: ["whatsapp", "future"],
    color: "#7c3aed",
    description: "Send an approved WhatsApp template with field variables.",
    group: "message",
    key: "template",
    label: "Template",
    status: "enabled",
    stepType: "template_message",
  },
  {
    channels: ["widget", "whatsapp", "future"],
    color: "#ca8a04",
    description: "Send a catalog-backed product list.",
    group: "message",
    key: "catalogue_message",
    label: "Catalogue Message",
    status: "enabled",
    stepType: "catalog_message",
  },
  {
    channels: ["widget", "whatsapp", "future"],
    color: "#ca8a04",
    description: "Send one product from a configured catalog.",
    group: "message",
    key: "single_product",
    label: "Single Product",
    status: "enabled",
    stepType: "single_product",
  },
  {
    channels: ["widget", "whatsapp", "future"],
    color: "#ca8a04",
    description: "Send multiple products from a configured catalog.",
    group: "message",
    key: "multiple_products",
    label: "Multiple Products",
    status: "enabled",
    stepType: "multiple_products",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#ca8a04",
    description: "Ask the user to choose one configured product.",
    group: "action",
    key: "product_selection",
    label: "Product Selection",
    status: "enabled",
    stepType: "product_selection",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#7c3aed",
    description: "Display a computed or collected result.",
    group: "message",
    key: "display_result",
    label: "Display Result",
    status: "enabled",
    stepType: "display_result",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#9333ea",
    description: "Ask the user to confirm collected details.",
    group: "message",
    key: "confirmation",
    label: "Confirmation",
    status: "enabled",
    stepType: "confirmation",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#111827",
    description: "Submit the collected flow data.",
    group: "action",
    key: "submit",
    label: "Submit",
    status: "enabled",
    stepType: "submit",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#ea580c",
    description: "Run a configured project operation.",
    group: "action",
    key: "api_request",
    label: "API Request",
    status: "enabled",
    stepType: "operation",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#dc2626",
    description: "Request a human handoff or manual review.",
    group: "action",
    key: "request_intervention",
    label: "Request Intervention",
    status: "enabled",
    stepType: "handoff",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Set a contact attribute from a value or field.",
    group: "action",
    key: "set_attribute",
    label: "Set Attribute",
    status: "enabled",
    stepType: "set_attribute",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#16a34a",
    description: "Add one or more tags to a contact.",
    group: "action",
    key: "add_tag",
    label: "Add Tag",
    status: "enabled",
    stepType: "add_tag",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#334155",
    description: "Route into another configured flow.",
    group: "action",
    key: "connect_flow",
    label: "Connect Flow",
    status: "enabled",
    stepType: "connect_flow",
  },
] as const;

const PLANNED_COMPONENTS: readonly FlowComponentDefinition[] = [
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#2563eb",
    description: "Send text with quick reply buttons.",
    group: "message",
    key: "text_buttons",
    label: "Text + Buttons",
    status: "planned",
  },
  {
    channels: ["project_chat", "widget", "whatsapp", "future"],
    color: "#2563eb",
    description: "Send a structured list selection message.",
    group: "message",
    key: "list_message",
    label: "List Message",
    status: "planned",
  },
] as const;

export const FLOW_COMPONENTS: readonly FlowComponentDefinition[] = [
  ...CURRENT_STEP_COMPONENTS,
  ...PLANNED_COMPONENTS,
] as const;

const ACTION_STEP_TYPE_SET = new Set<ActionStepType>(ACTION_STEP_TYPES);

export function formatFlowComponentLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getFlowComponentByStepType(stepType: string) {
  return (
    FLOW_COMPONENTS.find(
      (component) =>
        component.stepType === stepType && component.status === "enabled",
    ) ?? null
  );
}

export function getFlowComponentLabel(stepType: string) {
  return (
    getFlowComponentByStepType(stepType)?.label ??
    formatFlowComponentLabel(stepType)
  );
}

export function getFlowComponentColor(stepType: string) {
  return getFlowComponentByStepType(stepType)?.color ?? "#111827";
}

export function listEnabledStepFlowComponents(): StepFlowComponentDefinition[] {
  return FLOW_COMPONENTS.filter(
    (component): component is StepFlowComponentDefinition =>
      component.status === "enabled" &&
      component.stepType !== undefined &&
      ACTION_STEP_TYPE_SET.has(component.stepType),
  );
}

export function listPlannedFlowComponents() {
  return FLOW_COMPONENTS.filter((component) => component.status === "planned");
}
