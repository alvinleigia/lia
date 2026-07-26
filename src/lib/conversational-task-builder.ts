import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";

export const FRIENDLY_TASK_FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "email", label: "Email address" },
  { value: "phone", label: "Phone number" },
  { value: "integer", label: "Whole number" },
  { value: "decimal", label: "Amount or decimal" },
  { value: "boolean", label: "Yes or no" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "date_range", label: "Date range" },
  { value: "address", label: "Address" },
  { value: "location", label: "Location" },
  { value: "media", label: "File or image" },
  { value: "enum", label: "Choice list" },
  { value: "project_resource", label: "Project catalog item" },
] as const;

export const TASK_FIELD_RESOURCE_TYPES = [
  { value: "serviceCategory", label: "Catalog category" },
  { value: "service", label: "Catalog item or service" },
  { value: "media", label: "Media library item" },
] as const;

export type TaskField = ConversationalTaskDefinitionV1["fields"][number];

export function getFriendlyTaskFieldType(type: TaskField["type"]) {
  return (
    FRIENDLY_TASK_FIELD_TYPES.find((option) => option.value === type)?.label ??
    type.replaceAll("_", " ")
  );
}

export function createStableFieldKey(label: string) {
  const words = label
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const value = words
    .map((word, index) => {
      const normalized = word.replace(/[^\p{L}\p{N}]/gu, "");
      if (index === 0) {
        return normalized.toLowerCase();
      }
      return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
    })
    .join("")
    .replace(/^[^a-z]+/, "");

  return (value || "field").slice(0, 80);
}

export function createUniqueFieldKey(
  preferredKey: string,
  existingKeys: Iterable<string>,
) {
  const keys = new Set(existingKeys);
  const base = createStableFieldKey(preferredKey);
  if (!keys.has(base)) return base;

  let suffix = 2;
  let candidate = `${base.slice(0, 80 - String(suffix).length)}${suffix}`;
  while (keys.has(candidate)) {
    suffix += 1;
    candidate = `${base.slice(0, 80 - String(suffix).length)}${suffix}`;
  }
  return candidate;
}

export const GUIDED_CONDITION_OPERATORS = [
  { value: "present", label: "has an answer" },
  { value: "missing", label: "has no answer" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
] as const;

export type GuidedConditionOperator =
  (typeof GUIDED_CONDITION_OPERATORS)[number]["value"];

export function buildRequiredWhen(input: {
  fieldKey: string;
  operator: GuidedConditionOperator;
  value?: string | null;
}) {
  if (input.operator === "present" || input.operator === "missing") {
    return `${input.fieldKey} is ${input.operator}`;
  }
  const value = input.value?.trim();
  if (!value) return null;
  return `${input.fieldKey} ${input.operator === "equals" ? "==" : "!="} ${JSON.stringify(value)}`;
}

export function parseGuidedRequiredWhen(expression: string | null) {
  if (!expression) return null;
  const presence = expression.match(
    /^([a-z][a-zA-Z0-9_]*) is (present|missing)$/i,
  );
  if (presence) {
    return {
      fieldKey: presence[1],
      operator: presence[2].toLowerCase() as GuidedConditionOperator,
      value: "",
    };
  }
  const comparison = expression.match(
    /^([a-z][a-zA-Z0-9_]*)\s*(==|=|!=)\s*(.+)$/i,
  );
  if (!comparison) return null;
  const rawValue = comparison[3].trim();
  let value = rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    if (typeof parsed === "string") value = parsed;
  } catch {
    value = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return {
    fieldKey: comparison[1],
    operator: (comparison[2] === "!="
      ? "not_equals"
      : "equals") as GuidedConditionOperator,
    value,
  };
}

export function buildFriendlyValidation(
  kind: "none" | "minimum_length" | "maximum_length",
  value: string,
) {
  const amount = Number(value);
  if (kind === "none") return null;
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) return null;
  return kind === "minimum_length"
    ? `minLength:${amount}`
    : `maxLength:${amount}`;
}

export function parseFriendlyValidation(validation: string | null) {
  const match = validation?.match(/^(minLength|maxLength):(\d+)$/);
  if (!match) {
    return {
      kind: validation ? ("existing" as const) : ("none" as const),
      value: "",
    };
  }
  return {
    kind:
      match[1] === "minLength"
        ? ("minimum_length" as const)
        : ("maximum_length" as const),
    value: match[2],
  };
}

export function taskFieldTypeFromActionInputTypes(inputTypes: string[]) {
  const values = inputTypes.map((value) => value.toLowerCase());
  if (values.some((value) => value.includes("email"))) return "email" as const;
  if (values.some((value) => value.includes("phone"))) return "phone" as const;
  if (values.some((value) => value.includes("date_range"))) {
    return "date_range" as const;
  }
  if (values.some((value) => value.includes("date"))) return "date" as const;
  if (values.some((value) => value.includes("time"))) return "time" as const;
  if (values.some((value) => value.includes("number"))) {
    return "decimal" as const;
  }
  if (values.some((value) => value.includes("choice"))) return "enum" as const;
  if (values.some((value) => value.includes("file"))) return "media" as const;
  return "text" as const;
}

export function moveTaskField(
  fields: TaskField[],
  fieldId: string,
  direction: "up" | "down",
) {
  const index = fields.findIndex((field) => field.id === fieldId);
  if (index < 0) return fields;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= fields.length) return fields;

  const next = [...fields];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function findTaskFieldReferences(
  definition: ConversationalTaskDefinitionV1,
  fieldKey: string,
) {
  const references: string[] = [];
  for (const field of definition.fields) {
    if (field.key === fieldKey) continue;
    if (
      field.dependsOn.includes(fieldKey) ||
      (field.optionSource?.kind === "project_resource" &&
        field.optionSource.filterByField === fieldKey) ||
      field.requiredWhen?.includes(fieldKey)
    ) {
      references.push(field.label);
    }
  }
  for (const outcome of definition.outcomes) {
    if (outcome.condition?.includes(fieldKey)) {
      references.push(`outcome ${outcome.label}`);
    }
  }
  return references;
}

export function taskFieldNeedsSetup(
  field: TaskField,
  resources: {
    catalogIds: Set<number>;
    catalogCount: number;
    mediaCount: number;
    productCatalogIds: Set<number>;
    productCount: number;
  },
) {
  if (field.optionSource?.kind !== "project_resource") return false;
  const resourceType = field.optionSource.resourceType.toLowerCase();
  const catalogIdMatch =
    field.optionSource.collectionKey?.match(/^catalog:(\d+)$/i);
  const catalogId = catalogIdMatch ? Number(catalogIdMatch[1]) : null;

  if (["catalog", "category", "servicecategory"].includes(resourceType)) {
    return catalogId
      ? !resources.catalogIds.has(catalogId)
      : resources.catalogCount === 0;
  }
  if (["product", "service", "catalogproduct"].includes(resourceType)) {
    return catalogId
      ? !resources.productCatalogIds.has(catalogId)
      : resources.productCount === 0;
  }
  if (["media", "mediaasset", "asset"].includes(resourceType)) {
    return resources.mediaCount === 0;
  }
  return true;
}
