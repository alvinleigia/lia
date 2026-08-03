export const FLOW_ACTION_STEP_TYPES = [
  "submit",
  "operation",
  "handoff",
  "connect_flow",
  "set_attribute",
  "add_tag",
  "remove_tag",
  "subscribe",
  "unsubscribe",
  "assign_agent",
  "assign_team",
  "wait",
] as const;

export type FlowActionStepType = (typeof FLOW_ACTION_STEP_TYPES)[number];

export const FLOW_ACTION_FAMILY_KEYS = [
  "completion",
  "integration",
  "handoff",
  "subflow",
  "contact_attribute",
  "contact_tag",
  "contact_tag_removal",
  "contact_subscription",
  "contact_unsubscription",
  "agent_assignment",
  "team_assignment",
  "condition",
  "ai_knowledge",
  "wait",
] as const;

export type FlowActionFamilyKey = (typeof FLOW_ACTION_FAMILY_KEYS)[number];
export type FlowActionAvailability = "planned" | "route" | "supported";

export type FlowActionField =
  | "attributeField"
  | "attributeName"
  | "attributeValue"
  | "attributeValueSource"
  | "agentEmail"
  | "completionMessage"
  | "connectedFlow"
  | "connectedFlowMode"
  | "handoffMessage"
  | "handoffPriority"
  | "handoffQueue"
  | "notifyTeam"
  | "operation"
  | "operationRoutes"
  | "operationTiming"
  | "tags"
  | "teamName"
  | "waitDuration"
  | "waitMessage";

export type FlowActionFamilyDefinition = {
  availability: FlowActionAvailability;
  description: string;
  fields: readonly FlowActionField[];
  key: FlowActionFamilyKey;
  plannedReason?: string;
  stepType?: FlowActionStepType;
  title: string;
};

export const FLOW_ACTION_FAMILY_DEFINITIONS: Record<
  FlowActionFamilyKey,
  FlowActionFamilyDefinition
> = {
  completion: {
    availability: "supported",
    description: "Finish the flow and save the visitor's collected details.",
    fields: ["completionMessage"],
    key: "completion",
    stepType: "submit",
    title: "Complete flow",
  },
  integration: {
    availability: "supported",
    description:
      "Run one configured project operation during or after the flow.",
    fields: ["operation", "operationTiming", "operationRoutes"],
    key: "integration",
    stepType: "operation",
    title: "Run integration",
  },
  handoff: {
    availability: "supported",
    description: "Pause automation and send the conversation for human review.",
    fields: [
      "handoffMessage",
      "handoffQueue",
      "handoffPriority",
      "notifyTeam",
      "operation",
    ],
    key: "handoff",
    stepType: "handoff",
    title: "Hand off to team",
  },
  subflow: {
    availability: "supported",
    description: "Continue in another published flow from this project.",
    fields: ["connectedFlow", "connectedFlowMode"],
    key: "subflow",
    stepType: "connect_flow",
    title: "Connect another flow",
  },
  contact_attribute: {
    availability: "supported",
    description: "Save a reusable value on the current contact profile.",
    fields: [
      "attributeName",
      "attributeValueSource",
      "attributeField",
      "attributeValue",
    ],
    key: "contact_attribute",
    stepType: "set_attribute",
    title: "Update contact detail",
  },
  contact_tag: {
    availability: "supported",
    description: "Apply one or more labels to the current contact.",
    fields: ["tags"],
    key: "contact_tag",
    stepType: "add_tag",
    title: "Tag contact",
  },
  contact_tag_removal: {
    availability: "supported",
    description: "Remove one or more existing labels from the current contact.",
    fields: ["tags"],
    key: "contact_tag_removal",
    stepType: "remove_tag",
    title: "Remove contact tag",
  },
  contact_subscription: {
    availability: "supported",
    description:
      "Record whether the current contact is subscribed or unsubscribed.",
    fields: [],
    key: "contact_subscription",
    stepType: "subscribe",
    title: "Subscribe contact",
  },
  contact_unsubscription: {
    availability: "supported",
    description: "Record that the current contact is unsubscribed.",
    fields: [],
    key: "contact_unsubscription",
    stepType: "unsubscribe",
    title: "Unsubscribe contact",
  },
  agent_assignment: {
    availability: "supported",
    description:
      "Assign the contact to an active member of this project company.",
    fields: ["agentEmail"],
    key: "agent_assignment",
    stepType: "assign_agent",
    title: "Assign agent",
  },
  team_assignment: {
    availability: "supported",
    description: "Assign the contact to a named team or queue.",
    fields: ["teamName"],
    key: "team_assignment",
    stepType: "assign_team",
    title: "Assign team",
  },
  condition: {
    availability: "route",
    description: "Choose a field, comparison, and destination for a branch.",
    fields: [],
    key: "condition",
    title: "Conditional route",
  },
  ai_knowledge: {
    availability: "planned",
    description: "Generate a grounded response from project knowledge.",
    fields: [],
    key: "ai_knowledge",
    plannedReason:
      "Available after prompt, grounding, output, and failure contracts are implemented.",
    title: "AI and knowledge",
  },
  wait: {
    availability: "supported",
    description: "Pause a flow and resume it later without losing progress.",
    fields: ["waitDuration", "waitMessage"],
    key: "wait",
    stepType: "wait",
    title: "Wait",
  },
};

const ACTION_FAMILY_BY_STEP_TYPE = new Map<
  FlowActionStepType,
  FlowActionFamilyDefinition
>(
  Object.values(FLOW_ACTION_FAMILY_DEFINITIONS)
    .filter(
      (
        definition,
      ): definition is FlowActionFamilyDefinition & {
        stepType: FlowActionStepType;
      } =>
        definition.availability === "supported" &&
        definition.stepType !== undefined,
    )
    .map((definition) => [definition.stepType, definition]),
);

export function isFlowActionStepType(
  stepType: string,
): stepType is FlowActionStepType {
  return FLOW_ACTION_STEP_TYPES.includes(stepType as FlowActionStepType);
}

export function getFlowActionFamilyDefinition(stepType: string) {
  return isFlowActionStepType(stepType)
    ? (ACTION_FAMILY_BY_STEP_TYPE.get(stepType) ?? null)
    : null;
}

export function isFlowActionFieldRelevant(
  stepType: string,
  field: FlowActionField,
) {
  return (
    getFlowActionFamilyDefinition(stepType)?.fields.includes(field) ?? false
  );
}

export function listPlannedFlowActionFamilies() {
  return Object.values(FLOW_ACTION_FAMILY_DEFINITIONS).filter(
    (definition) => definition.availability === "planned",
  );
}
