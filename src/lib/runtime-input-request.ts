import type { TaskFieldDefinition } from "@/lib/conversational-task-field-validation";

export const RUNTIME_INPUT_KINDS = [
  "choice",
  "date",
  "email",
  "number",
  "phone",
  "text",
  "time",
] as const;

export type RuntimeInputKind = (typeof RUNTIME_INPUT_KINDS)[number];

export type RuntimeInputRequest = {
  fieldKey: string;
  inputKind: RuntimeInputKind;
  label: string;
  options: Array<{ label: string; value: string }>;
  required: boolean;
};

function getInputKind(field: TaskFieldDefinition): RuntimeInputKind {
  if (field.optionSource?.kind === "static" || field.type === "boolean") {
    return "choice";
  }
  if (
    field.type === "date" ||
    field.type === "email" ||
    field.type === "time"
  ) {
    return field.type;
  }
  if (field.type === "decimal" || field.type === "integer") {
    return "number";
  }
  if (field.type === "phone") {
    return "phone";
  }
  return "text";
}

export function createTaskRuntimeInputRequest(
  field: TaskFieldDefinition,
): RuntimeInputRequest {
  const options =
    field.optionSource?.kind === "static"
      ? field.optionSource.options
      : field.type === "boolean"
        ? [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ]
        : [];

  return {
    fieldKey: field.key,
    inputKind: getInputKind(field),
    label: field.label,
    options,
    required: field.required,
  };
}

export function parseRuntimeInputRequest(
  value: unknown,
): RuntimeInputRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RuntimeInputRequest>;
  if (
    typeof candidate.fieldKey !== "string" ||
    typeof candidate.label !== "string" ||
    typeof candidate.required !== "boolean" ||
    !RUNTIME_INPUT_KINDS.includes(candidate.inputKind as RuntimeInputKind) ||
    !Array.isArray(candidate.options)
  ) {
    return null;
  }

  const options = candidate.options.filter(
    (option): option is { label: string; value: string } =>
      Boolean(
        option &&
          typeof option === "object" &&
          typeof option.label === "string" &&
          typeof option.value === "string",
      ),
  );
  if (options.length !== candidate.options.length) {
    return null;
  }

  return {
    fieldKey: candidate.fieldKey,
    inputKind: candidate.inputKind as RuntimeInputKind,
    label: candidate.label,
    options,
    required: candidate.required,
  };
}
