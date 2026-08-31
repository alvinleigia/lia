import type {
  ConversationalTaskDefinitionV1,
  ConversationalTaskSnapshotV1,
} from "@/lib/conversation-contracts";
import type {
  FieldCandidateV1,
  TaskFieldState,
} from "@/lib/conversational-task-runtime-contracts";

export type RuntimeTaskField = {
  fieldId: string;
  fieldKey: string;
  fieldType: string;
  state: TaskFieldState;
  isRequired: boolean;
  sensitivity: "standard" | "personal" | "sensitive";
  naturalValue: unknown;
  canonicalValue: unknown;
  candidates: unknown[];
  provenance: Record<string, unknown>;
  validation: Record<string, unknown>;
  attemptCount: number;
  revision: number;
  lastRequestedAt: Date | null;
  validatedAt: Date | null;
  expiresAt: Date | null;
};

type FieldUpdate = RuntimeTaskField & {
  changed: boolean;
  dependencyInvalidated: boolean;
};

function isPresent(field: RuntimeTaskField | undefined) {
  return (
    field?.state === "valid" ||
    field?.state === "confirmed" ||
    field?.state === "candidate"
  );
}

function comparableValue(field: RuntimeTaskField | undefined) {
  const value = field?.canonicalValue ?? field?.naturalValue;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return null;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function evaluateRequiredClause(
  clause: string,
  fields: Map<string, RuntimeTaskField>,
): boolean | null {
  const presentMatch = clause.match(
    /^([a-z][a-zA-Z0-9_]*)\s+is\s+(present|missing)$/i,
  );
  if (presentMatch) {
    const present = isPresent(fields.get(presentMatch[1]));
    return presentMatch[2].toLowerCase() === "present" ? present : !present;
  }

  const comparisonMatch = clause.match(
    /^([a-z][a-zA-Z0-9_]*)\s*(==|=|!=)\s*(.+)$/i,
  );
  if (comparisonMatch) {
    const current = comparableValue(fields.get(comparisonMatch[1]));
    const expected = unquote(comparisonMatch[3]).toLowerCase();
    if (current === null) return false;
    return comparisonMatch[2] === "!="
      ? current !== expected
      : current === expected;
  }

  return null;
}

export function evaluateRequiredWhen(
  expression: string | null,
  fields: Map<string, RuntimeTaskField>,
): boolean | null {
  if (!expression?.trim()) return null;

  const orGroups = expression
    .split(/\s+or\s+/i)
    .map((group) => group.trim())
    .filter(Boolean);
  let understood = true;
  const result = orGroups.some((group) => {
    const clauses = group
      .split(/\s+and\s+/i)
      .map((clause) => clause.trim())
      .filter(Boolean);
    return clauses.every((clause) => {
      const value = evaluateRequiredClause(clause, fields);
      if (value === null) understood = false;
      return value ?? false;
    });
  });

  return understood ? result : null;
}

export function initializeRuntimeTaskFields(input: {
  expiresAt: Date;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  const fields = new Map<string, RuntimeTaskField>(
    input.snapshot.task.definition.fields.map((field) => [
      field.key,
      {
        attemptCount: 0,
        candidates: [],
        canonicalValue: null,
        expiresAt: input.expiresAt,
        fieldId: field.id,
        fieldKey: field.key,
        fieldType: field.type,
        isRequired: field.required,
        lastRequestedAt: null,
        naturalValue: null,
        provenance: {},
        revision: 0,
        sensitivity: field.sensitivity,
        state: "missing",
        validatedAt: null,
        validation: {},
      },
    ]),
  );

  return recalculateRequiredFields(input.snapshot.task.definition, fields);
}

export function recalculateRequiredFields(
  definition: ConversationalTaskDefinitionV1,
  fields: Map<string, RuntimeTaskField>,
) {
  const next = new Map(fields);
  for (const definitionField of definition.fields) {
    const current = next.get(definitionField.key);
    if (!current) continue;
    const conditional = evaluateRequiredWhen(
      definitionField.requiredWhen,
      fields,
    );
    next.set(definitionField.key, {
      ...current,
      isRequired: definitionField.required || conditional === true,
    });
  }
  return next;
}

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dependentFieldKeys(
  definition: ConversationalTaskDefinitionV1,
  changedKeys: Set<string>,
) {
  const dependents = new Set<string>();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const field of definition.fields) {
      if (
        !dependents.has(field.key) &&
        field.dependsOn.some(
          (key) => changedKeys.has(key) || dependents.has(key),
        )
      ) {
        dependents.add(field.key);
        expanded = true;
      }
    }
  }
  return dependents;
}

export function applyFieldCandidates(input: {
  candidates: FieldCandidateV1[];
  definition: ConversationalTaskDefinitionV1;
  eventId: string;
  fields: Map<string, RuntimeTaskField>;
  now: Date;
}) {
  const grouped = new Map<string, FieldCandidateV1[]>();
  for (const candidate of input.candidates) {
    const current = grouped.get(candidate.fieldKey) ?? [];
    current.push(candidate);
    grouped.set(candidate.fieldKey, current);
  }

  const updates = new Map<string, FieldUpdate>();
  const changedKeys = new Set<string>();
  for (const [key, candidates] of grouped) {
    const current = input.fields.get(key);
    if (!current) continue;
    const selected = candidates.at(-1);
    if (!selected) continue;
    const canonicalValue =
      selected.canonicalValue === undefined
        ? selected.naturalValue
        : selected.canonicalValue;
    const changed = !valuesMatch(current.canonicalValue, canonicalValue);
    const nextState =
      !changed && current.state === "confirmed" && selected.state === "valid"
        ? "confirmed"
        : selected.state;
    if (changed) changedKeys.add(key);
    updates.set(key, {
      ...current,
      attemptCount: current.attemptCount + 1,
      candidates: candidates.map((candidate) => ({
        canonicalValue:
          candidate.canonicalValue === undefined
            ? candidate.naturalValue
            : candidate.canonicalValue,
        naturalValue: candidate.naturalValue,
        state: candidate.state,
      })),
      canonicalValue,
      changed,
      dependencyInvalidated: false,
      naturalValue: selected.naturalValue,
      provenance: {
        eventId: input.eventId,
        source: selected.provenance.source,
        sourceReference: selected.provenance.sourceReference,
      },
      revision: current.revision + 1,
      state: nextState,
      validatedAt: nextState === "candidate" ? current.validatedAt : input.now,
      validation: {
        checkedAt: input.now.toISOString(),
        code: selected.validation.code,
        message: selected.validation.message,
        valid: selected.validation.valid,
      },
    });
  }

  const merged = new Map(input.fields);
  for (const [key, update] of updates) merged.set(key, update);

  for (const key of dependentFieldKeys(input.definition, changedKeys)) {
    if (grouped.has(key)) continue;
    const current = merged.get(key);
    if (
      !current ||
      current.state === "missing" ||
      current.state === "cleared"
    ) {
      continue;
    }
    const invalidated: FieldUpdate = {
      ...current,
      changed: false,
      dependencyInvalidated: true,
      revision: current.revision + 1,
      state: "candidate",
      validatedAt: null,
      validation: {
        code: "dependency_changed",
        message: "Revalidation is required because a dependency changed.",
        valid: false,
      },
    };
    merged.set(key, invalidated);
    updates.set(key, invalidated);
  }

  const recalculated = recalculateRequiredFields(input.definition, merged);
  for (const [key, current] of recalculated) {
    const previous = merged.get(key);
    if (!previous || previous.isRequired === current.isRequired) continue;
    const existing = updates.get(key);
    updates.set(key, {
      ...(existing ?? current),
      changed: existing?.changed ?? false,
      dependencyInvalidated: existing?.dependencyInvalidated ?? false,
      isRequired: current.isRequired,
    });
  }

  return { fields: recalculated, updates };
}

export function clearRuntimeField(input: {
  definition: ConversationalTaskDefinitionV1;
  eventId: string;
  fieldKey: string;
  fields: Map<string, RuntimeTaskField>;
  now: Date;
  reason: string;
}) {
  const current = input.fields.get(input.fieldKey);
  if (!current) return { fields: input.fields, updates: new Map() };

  const result = applyFieldCandidates({
    candidates: [
      {
        canonicalValue: null,
        fieldKey: input.fieldKey,
        naturalValue: null,
        provenance: {
          source: "visitor",
          sourceReference: input.reason,
        },
        state: "candidate",
        validation: {
          code: "cleared",
          message: null,
          valid: false,
        },
      },
    ],
    definition: input.definition,
    eventId: input.eventId,
    fields: input.fields,
    now: input.now,
  });
  const cleared = result.fields.get(input.fieldKey);
  if (!cleared) return result;

  const nextCleared: FieldUpdate = {
    ...cleared,
    candidates: [],
    canonicalValue: null,
    changed: current.canonicalValue !== null || current.naturalValue !== null,
    dependencyInvalidated: false,
    naturalValue: null,
    provenance: {
      eventId: input.eventId,
      reason: input.reason,
      source: "visitor",
    },
    state: "cleared",
    validatedAt: null,
    validation: {},
  };
  result.fields.set(input.fieldKey, nextCleared);
  result.updates.set(input.fieldKey, nextCleared);
  return result;
}

export function resetRuntimeFields(
  fields: Map<string, RuntimeTaskField>,
  now: Date,
) {
  return new Map(
    [...fields].map(([key, field]) => [
      key,
      {
        ...field,
        attemptCount: 0,
        candidates: [],
        canonicalValue: null,
        lastRequestedAt: null,
        naturalValue: null,
        provenance: { resetAt: now.toISOString() },
        revision: field.revision + 1,
        state: "missing" as const,
        validatedAt: null,
        validation: {},
      },
    ]),
  );
}
