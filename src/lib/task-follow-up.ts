import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import type { TurnResultV1 } from "@/lib/conversation-turn-contracts";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
} from "@/lib/hybrid-flow-contracts";

type FollowUpField = {
  fieldKey: string;
  state: string;
  canonicalValue?: unknown;
};

export const FOLLOW_UP_CONSENT_PROMPT =
  "Would you like our team to follow up on this question?";

export function hasTaskFollowUpDestination(input: {
  definition: ConversationalTaskDefinitionV1;
  node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }>;
  graph: CompiledHybridFlowGraphV1;
}) {
  const completed = input.definition.outcomes.filter(
    (outcome) => outcome.type === "completed" && !outcome.condition,
  );
  const target =
    completed.length === 1
      ? input.node.settings.outcomeRoutes[completed[0].outputPort]
      : null;
  return Boolean(
    target &&
      input.graph.nodes.some(
        (node) =>
          node.sourceStepId === target &&
          node.kind === "deterministic" &&
          node.stepType === "handoff",
      ),
  );
}

export function validateTaskFollowUp(
  definition: ConversationalTaskDefinitionV1,
) {
  const config = definition.followUp;
  if (!config) return [];
  const issues: string[] = [];
  if (new Set(Object.values(config)).size !== 4)
    issues.push("Follow-up fields must be different fields.");
  for (const [role, key] of Object.entries(config)) {
    const field = definition.fields.find((item) => item.key === key);
    const types =
      role === "consentField"
        ? ["boolean"]
        : role === "contactField"
          ? ["phone", "email"]
          : ["text"];
    if (!field || !types.includes(field.type) || field.cardinality !== "single")
      issues.push(
        `Choose a ${types.join(" or ")} field for follow-up ${role}.`,
      );
    if (
      field &&
      ["nameField", "contactField"].includes(role) &&
      !field.required
    )
      issues.push("Follow-up name and contact fields must be required.");
  }
  return issues;
}

export function taskFollowUpConsent(
  definition: ConversationalTaskDefinitionV1,
  fields: FollowUpField[],
): boolean | null {
  const field = fields.find(
    (item) => item.fieldKey === definition.followUp?.consentField,
  );
  return field &&
    ["valid", "confirmed"].includes(field.state) &&
    typeof field.canonicalValue === "boolean"
    ? field.canonicalValue
    : null;
}

export function isPendingTaskFollowUp(input: {
  definition: ConversationalTaskDefinitionV1;
  fields: FollowUpField[];
  requestedFieldKey: string | null;
}) {
  return Boolean(
    input.definition.followUp &&
      input.requestedFieldKey === input.definition.followUp.consentField &&
      taskFollowUpConsent(input.definition, input.fields) === null,
  );
}

export function parseTaskFollowUpConsent(text: string): boolean | null {
  if (
    /^(?:yes(?: please)?|sure|okay|ok|please do|true)[.!\s]*$/i.test(
      text.trim(),
    )
  )
    return true;
  if (/^(?:no(?: thanks| thank you)?|not now|false)[.!\s]*$/i.test(text.trim()))
    return false;
  return null;
}

// Recognize a referral, never a business topic. This also covers approved FAQ
// answers, which deliberately bypass the model. Ordinary facts do not qualify.
export function shouldOfferTaskFollowUp(proposal: TurnResultV1) {
  return (
    proposal.safety.decision === "allow" &&
    !proposal.ambiguity.requiresClarification &&
    (proposal.grounding.status === "no_answer" ||
      /\b(?:our|the)\s+(?:(?:reservations?|support|sales|service)\s+)?team\s+(?:can|will need to|needs to)\s+(?:clarify|check|confirm|verify)|\b(?:request|arrange)\s+a\s+callback\b/i.test(
        proposal.reply,
      ))
  );
}

export function taskFollowUpPrompt(input: {
  definition: ConversationalTaskDefinitionV1;
  fields: FollowUpField[];
  fieldKey: string;
}): string | null {
  const config = input.definition.followUp;
  if (!config) return null;
  if (
    input.fieldKey === config.consentField &&
    taskFollowUpConsent(input.definition, input.fields) === null
  )
    return FOLLOW_UP_CONSENT_PROMPT;
  if (taskFollowUpConsent(input.definition, input.fields) !== true) return null;
  if (input.fieldKey === config.nameField)
    return "What is your name so our team can follow up with you?";
  if (input.fieldKey === config.contactField) {
    const field = input.definition.fields.find(
      ({ key }) => key === config.contactField,
    );
    return field?.type === "email"
      ? "Which email address may our team use to follow up with you?"
      : "Which phone number, including country code, may our team use to follow up with you?";
  }
  return null;
}

export function taskFollowUpFieldOrder(
  definition: ConversationalTaskDefinitionV1,
  fields: FollowUpField[],
) {
  const config = definition.followUp;
  if (!config || taskFollowUpConsent(definition, fields) !== true)
    return definition.fields;
  const preferred = [config.nameField, config.contactField];
  return [
    ...preferred.flatMap((key) =>
      definition.fields.filter((field) => field.key === key),
    ),
    ...definition.fields.filter((field) => !preferred.includes(field.key)),
  ];
}

export function unresolvedTaskFollowUpConsent<T extends FollowUpField>(
  definition: ConversationalTaskDefinitionV1,
  fields: T[],
) {
  const config = definition.followUp;
  if (!config || taskFollowUpConsent(definition, fields) !== null) return null;
  const reason = fields.find((field) => field.fieldKey === config.reasonField);
  return reason &&
    ["valid", "confirmed"].includes(reason.state) &&
    reason.canonicalValue
    ? (fields.find((field) => field.fieldKey === config.consentField) ?? null)
    : null;
}

export function appendTaskFollowUpQuestion(
  previous: unknown,
  question: string,
) {
  const questions = typeof previous === "string" ? previous.split(" | ") : [];
  const current = question.replace(/\s+/g, " ").trim().slice(0, 400);
  return [...new Set([...questions, current])]
    .filter(Boolean)
    .join(" | ")
    .slice(-500);
}
