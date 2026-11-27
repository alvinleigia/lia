import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import type { TurnFieldStateV1, TurnRetrievalExcerptV1 } from "@/lib/conversation-turn-contracts";

// Outside the namespace of configurable context variables.
export const PENDING_CHOICE_QUESTION = "$pendingChoiceQuestion";

export function readPendingChoice(value: unknown) {
  if (!value || typeof value !== "object" || !("question" in value) || !("returnFieldKey" in value)) return null;
  if (typeof value.question !== "string" || (value.returnFieldKey !== null && typeof value.returnFieldKey !== "string")) return null;
  return { question: value.question, returnFieldKey: value.returnFieldKey };
}

export function questionKey(text: string) {
  return text.normalize("NFKC").trim().replace(/\?+$/, "").trim()
    .replace(/\s+/g, " ").toLowerCase();
}

export function resolveTaskKnowledgeChoice(
  definition: ConversationalTaskDefinitionV1 | undefined,
  text: string,
  states: TurnFieldStateV1[],
) {
  const key = questionKey(text);
  for (const field of definition?.fields ?? []) {
    const question = field.knowledgeQuestions?.find(item => questionKey(item) === key);
    if (!question || field.optionSource?.kind !== "static") continue;
    const state = states.find(item => item.fieldKey === field.key);
    const option = state && (state.state === "valid" || state.state === "confirmed")
      ? field.optionSource.options.find(item => item.value === state.value)
      : undefined;
    return { field, question, option, options: field.optionSource.options };
  }
  return null;
}

export function choicePassages(
  excerpts: TurnRetrievalExcerptV1[],
  choice: NonNullable<ReturnType<typeof resolveTaskKnowledgeChoice>>,
) {
  if (!choice.option) return [];
  const selected = questionKey(choice.option.label);
  const siblings = new Set(choice.options.map(option => questionKey(option.label)));
  siblings.delete(selected);
  return excerpts.filter(excerpt => {
    const headings = excerpt.sectionHeadings?.map(questionKey) ?? [];
    return headings.includes(selected) && !headings.some(heading => siblings.has(heading));
  });
}
