import { isExplicitCancellationRequest } from "@/lib/conversation-control-intents";
import type { TurnResultV1 } from "@/lib/conversation-turn-contracts";
import {
  TASK_FIELD_VALIDATORS,
  type TaskFieldDefinition,
  validateTaskFieldValue,
} from "@/lib/conversational-task-field-validation";

const clockTime = String.raw`(\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)`;
const datedWindow = new RegExp(
  [
    String.raw`^(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?`,
    String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]+\s+\d{4}|[a-z]+\s+\d{1,2},?\s+\d{4}),?\s+`,
    String.raw`(?:between\s+|from\s+)?`,
    clockTime,
    String.raw`\s*(?:and|to|[-–])\s*`,
    clockTime,
    String.raw`\s+(\(?)([a-z_]+(?:\/[a-z_+-]+)+|(?:UTC|GMT)(?:[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)?|(?:[a-z]+\s+){1,4}(?:Standard|Daylight|Summer) Time)(\)?)[.]?$`,
  ].join(""),
  "i",
);

// Record a preference for staff, preserving the original zone and wording.
function isCompleteTimeWindow(
  text: string,
  field: TaskFieldDefinition,
  projectZone: string,
) {
  if (
    field.type !== "text" ||
    field.optionSource ||
    !/\b(?:(?:time|callback|delivery|service|contact)\s+(?:window|range)|time\s+slot)\b/i.test(
      [
        field.label,
        field.prompt,
        field.key.replace(/([a-z])([A-Z])/g, "$1 $2"),
      ].join(" "),
    )
  )
    return false;
  const match = datedWindow.exec(text);
  if (!match) return false;
  const [, weekday, date, start, end, open, zone, close] = match;
  if (Boolean(open) !== Boolean(close)) return false;
  const day = TASK_FIELD_VALIDATORS.date(date, {
    referenceDate: new Date(),
    locale: "en",
    timezone: "UTC",
  });
  const from = TASK_FIELD_VALIDATORS.time(start);
  const to = TASK_FIELD_VALIDATORS.time(end);
  if (!day.ok || !from.ok || !to.ok || String(from.value) >= String(to.value))
    return false;
  const instant = new Date(String(day.value) + "T12:00:00Z");
  if (
    weekday &&
    new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" })
      .format(instant)
      .toLowerCase() !== weekday.toLowerCase()
  )
    return false;
  if (/^(?:UTC|GMT)/i.test(zone)) return true;
  try {
    if (zone.includes("/")) {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    }
    return [projectZone, ...Intl.supportedValuesOf("timeZone")].some(
      (timeZone) =>
        new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "long" })
          .formatToParts(instant)
          .some(
            (part) =>
              part.type === "timeZoneName" &&
              part.value.toLowerCase() === zone.toLowerCase(),
          ),
    );
  } catch {
    return false;
  }
}

// Resolve only an explicit request to use this channel's sender number.
// Never infer a phone from browser identity or choose between competing fields.
export function resolveChannelPhoneReference(input: {
  channel: string;
  externalUserId?: string | null;
  fields: TaskFieldDefinition[];
  requestedFieldKey?: string | null;
  text: string;
}): string {
  return extractChannelPhoneReference(input)?.text ?? input.text;
}

export function extractChannelPhoneReference(
  input: Parameters<typeof resolveChannelPhoneReference>[0],
) {
  if (
    input.channel !== "whatsapp" ||
    !input.externalUserId ||
    !/^\+?[1-9]\d{6,14}$/.test(input.externalUserId) ||
    /\b(?:not|don't|instead|rather|or)\b/i.test(input.text)
  )
    return null;
  const fields = input.fields.filter(
    (field) =>
      field.type === "phone" &&
      field.cardinality === "single" &&
      field.sourcePriority.includes("visitor") &&
      !field.optionSource,
  );
  const field =
    fields.find(({ key }) => key === input.requestedFieldKey) ??
    (fields.length === 1 ? fields[0] : null);
  if (!field) return null;
  const phone = `+${input.externalUserId.replace(/^\+/, "")}`;
  const reference =
    /(^|[.!?;\n]\s*|\band\s+)(?:(?:please|can you|could you|you may|you can)\s+)?(?:use|call me on|contact me on|reach me on)\s+(?:my|this)\s+whatsapp (?:phone )?number\b/gi;
  const text = input.text.replace(reference, (_, prefix: string) => {
    return `${prefix}${field.key}: ${phone}`;
  });
  return text === input.text
    ? null
    : {
        text,
        candidate: {
          fieldKey: field.key,
          naturalValue: phone,
          confidence: 1,
          source: "visitor" as const,
        },
      };
}

// Unscoped ambiguity is deliberately conservative. A model's confidence cannot
// override an explicitly uncertain field or choose between duplicate candidates.
export function getClearCandidatesDuringClarification(
  proposal: TurnResultV1,
  fields: TaskFieldDefinition[],
): TurnResultV1["fieldCandidates"] {
  const uncertain = proposal.ambiguity.fieldKeys;
  if (
    !proposal.ambiguity.requiresClarification ||
    !uncertain?.length ||
    proposal.safety.decision !== "allow"
  )
    return [];
  if (uncertain.some((key) => !fields.some((field) => field.key === key)))
    return [];
  return proposal.fieldCandidates.filter((candidate, _, candidates) => {
    const field = fields.find(({ key }) => key === candidate.fieldKey);
    return (
      field?.sourcePriority.includes("visitor") &&
      candidate.source === "visitor" &&
      candidate.confidence >= 0.7 &&
      !uncertain.includes(candidate.fieldKey) &&
      candidates.filter(({ fieldKey }) => fieldKey === candidate.fieldKey)
        .length === 1 &&
      (field.cardinality !== "single" || !Array.isArray(candidate.naturalValue))
    );
  });
}

// Only bypass model interpretation when the whole answer has an unambiguous
// mapping to configured fields. Labels disambiguate multiple fields of one type.
export function extractLocalTaskFieldCandidates(input: {
  fields: TaskFieldDefinition[];
  requestedFieldKey?: string | null;
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
  const requested = fields.find(
    (field) => field.key === input.requestedFieldKey,
  );
  if (requested && isCompleteTimeWindow(text, requested, input.timezone)) {
    return [
      {
        fieldKey: requested.key,
        naturalValue: text,
        confidence: 1,
        source: "visitor",
      },
    ];
  }
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
    const naturalValue = part.slice(separator + 1).trim();
    // A scalar followed by prose may contain another answer or instruction.
    // Let extraction separate the clauses instead of swallowing them into one
    // invalid field. Simple invalid values still reach deterministic validation.
    if (
      matching[0].type !== "text" &&
      /\s+\p{L}/u.test(naturalValue) &&
      !validateTaskFieldValue({
        field: matching[0],
        value: naturalValue,
        referenceDate: input.referenceDate,
        contextValues: new Map([["lia_timezone", input.timezone]]),
      }).ok
    )
      return null;
    labelled.push({
      fieldKey: matching[0].key,
      naturalValue,
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
