export const STRUCTURED_FORM_STATUSES = ["draft", "published"] as const;

export type StructuredFormSettings = {
  enabled: boolean;
  key: string;
  version: string;
  status: (typeof STRUCTURED_FORM_STATUSES)[number];
  fieldKeys: string[];
  presentation: "adaptive";
  providers: {
    whatsapp?: {
      schemaVersion: string;
      flow: Record<string, unknown>;
    };
  };
};

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getStructuredFormSettings(
  settings: Record<string, unknown>,
): StructuredFormSettings {
  const form = getRecord(settings.structuredForm);
  const providers = getRecord(form.providers);
  const whatsapp = getRecord(providers.whatsapp);
  const flow = getRecord(whatsapp.flow);

  return {
    enabled: form.enabled === true,
    key: typeof form.key === "string" ? form.key : "",
    version: typeof form.version === "string" ? form.version : "1.0.0",
    status: form.status === "published" ? "published" : "draft",
    fieldKeys: Array.isArray(form.fieldKeys)
      ? form.fieldKeys.filter((key): key is string => typeof key === "string")
      : [],
    presentation: "adaptive",
    providers:
      Object.keys(flow).length > 0 || typeof whatsapp.schemaVersion === "string"
        ? {
            whatsapp: {
              schemaVersion:
                typeof whatsapp.schemaVersion === "string"
                  ? whatsapp.schemaVersion
                  : "",
              flow,
            },
          }
        : {},
  };
}

export function parseStructuredFormFlowJson(value: string) {
  if (!value.trim()) {
    return { data: undefined } as const;
  }

  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { error: "WhatsApp Flow JSON must be an object." } as const;
    }
    return { data: data as Record<string, unknown> } as const;
  } catch {
    return { error: "WhatsApp Flow JSON is invalid." } as const;
  }
}

const FORBIDDEN_PROVIDER_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "token",
  "apikey",
  "accesstoken",
]);

function isCredentialKey(key: string) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    FORBIDDEN_PROVIDER_KEYS.has(normalizedKey) ||
    normalizedKey.endsWith("password") ||
    normalizedKey.endsWith("secret") ||
    normalizedKey.endsWith("token")
  );
}

function containsCredentialKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsCredentialKey);
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => isCredentialKey(key) || containsCredentialKey(child),
  );
}

export function validateStructuredFormForPublication(
  settings: Record<string, unknown>,
  collectableFieldKeys: string[],
) {
  const form = getStructuredFormSettings(settings);
  if (!form.enabled) {
    return [];
  }

  const issues: string[] = [];
  if (!/^[a-z][a-z0-9_-]*$/.test(form.key)) {
    issues.push(
      "Structured form key must use lowercase letters, numbers, dashes, or underscores.",
    );
  }
  if (!form.version.trim()) {
    issues.push("Structured form version is required.");
  }
  if (form.status !== "published") {
    issues.push(
      "Structured form must be marked Published before the action can be published.",
    );
  }
  if (form.fieldKeys.length === 0) {
    issues.push("Structured form must contain at least one task field.");
  }
  if (new Set(form.fieldKeys).size !== form.fieldKeys.length) {
    issues.push("Structured form field keys must be unique.");
  }

  const allowed = new Set(collectableFieldKeys);
  if (form.fieldKeys.some((fieldKey) => !allowed.has(fieldKey))) {
    issues.push(
      "Structured form field keys must reference enabled collection steps.",
    );
  }

  if (form.providers.whatsapp) {
    if (!form.providers.whatsapp.schemaVersion.trim()) {
      issues.push("WhatsApp Flow schema version is required.");
    }
    if (Object.keys(form.providers.whatsapp.flow).length === 0) {
      issues.push("WhatsApp Flow JSON is required.");
    }
    if (containsCredentialKey(form.providers.whatsapp.flow)) {
      issues.push(
        "WhatsApp Flow JSON must not contain credentials or secrets.",
      );
    }
  }

  return issues;
}
