import { isExplicitCancellationRequest } from "@/lib/conversation-control-intents";
import type { TurnResultV1 } from "@/lib/conversation-turn-contracts";
import {
  type TaskFieldDefinition,
  validateTaskFieldValue,
} from "@/lib/conversational-task-field-validation";

// Only bypass model interpretation when the whole answer has an unambiguous
// mapping to configured fields. Labels disambiguate multiple fields of one type.
export function extractLocalTaskFieldCandidates(input: {
  fields: TaskFieldDefinition[];
  text: string;
  timezone: string;
  referenceDate?: Date;
}): TurnResultV1["fieldCandidates"] | null {
  const text = input.text.trim();
  if (!text || isExplicitCancellationRequest(text)) return null;
  const fields = input.fields.filter(
    (field) =>
      field.sourcePriority.includes("visitor") &&
      field.optionSource?.kind !== "project_resource" &&
      field.cardinality === "single",
  );
  const parts = text
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter(Boolean);
  const labelled: TurnResultV1["fieldCandidates"] = [];
  for (const part of parts) {
    const separator = part.indexOf(":");
    const label = part.slice(0, separator).trim().toLowerCase();
    const matching = fields.filter((field) =>
      [field.key.toLowerCase(), field.label.toLowerCase()].includes(label),
    );
    if (
      separator < 1 ||
      matching.length !== 1 ||
      !part.slice(separator + 1).trim()
    ) {
      labelled.length = 0;
      break;
    }
    labelled.push({
      fieldKey: matching[0].key,
      naturalValue: part.slice(separator + 1).trim(),
      confidence: 1,
      source: "visitor",
    });
  }
  if (labelled.length) {
    if (
      new Set(labelled.map(({ fieldKey }) => fieldKey)).size !== labelled.length
    )
      return null;
    return labelled;
  }
  // Restrict bare scalar matching to self-identifying formats, never arbitrary
  // text, an appointment reference, a number or a competing multi-field sentence.
  const type = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
    ? "email"
    : /^\+\d[\d ()-]{6,20}$/.test(text)
      ? "phone"
      : /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? "date"
        : /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[ap]m)?$|^\d{1,2}\s*[ap]m$/i.test(
              text,
            )
          ? "time"
          : null;
  const matching = fields.filter((field) => field.type === type);
  if (matching.length !== 1) return null;
  const result = validateTaskFieldValue({
    field: matching[0],
    value: text,
    referenceDate: input.referenceDate,
    contextValues: new Map([["lia_timezone", input.timezone]]),
  });
  if (!result.ok) return null;
  return [
    {
      fieldKey: matching[0].key,
      naturalValue: text,
      confidence: 1,
      source: "visitor",
    },
  ];
}
