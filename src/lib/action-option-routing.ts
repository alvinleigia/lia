export const ACTION_OPTION_OUTPUT_PORT_PREFIX = "option:";
export const ACTION_OPTION_ROUTE_SETTINGS_KEY = "optionRoute";

export type StoredActionOptionRoute = {
  schemaVersion: 1;
  sourceOptionId: string;
  sourceOutputPort: string;
};

export type StoredActionOption = {
  id: string;
  label: string;
  outputPort: string;
  value: boolean | number | string;
};

export function buildActionOptionOutputPort(optionId: string) {
  return `${ACTION_OPTION_OUTPUT_PORT_PREFIX}${optionId}`;
}

export function getActionOptionIdFromOutputPort(outputPort: string | null) {
  if (!outputPort?.startsWith(ACTION_OPTION_OUTPUT_PORT_PREFIX)) {
    return null;
  }

  const optionId = outputPort.slice(ACTION_OPTION_OUTPUT_PORT_PREFIX.length);
  return optionId || null;
}

export function getActionOptionIdentity(input: {
  fallbackId: string;
  id?: unknown;
}) {
  const storedId =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : input.fallbackId;

  return {
    id: storedId,
    outputPort: buildActionOptionOutputPort(storedId),
  };
}

export function buildStoredActionOptionRoute(
  sourceOptionId: string,
): StoredActionOptionRoute {
  const normalizedId = sourceOptionId.trim();

  return {
    schemaVersion: 1,
    sourceOptionId: normalizedId,
    sourceOutputPort: buildActionOptionOutputPort(normalizedId),
  };
}

export function getStoredActionOptionRoute(
  settings: Record<string, unknown>,
): StoredActionOptionRoute | null {
  const route = settings[ACTION_OPTION_ROUTE_SETTINGS_KEY];
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    return null;
  }

  const record = route as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.sourceOptionId !== "string" ||
    !record.sourceOptionId.trim()
  ) {
    return null;
  }

  const expectedOutputPort = buildActionOptionOutputPort(
    record.sourceOptionId.trim(),
  );
  if (record.sourceOutputPort !== expectedOutputPort) {
    return null;
  }

  return buildStoredActionOptionRoute(record.sourceOptionId);
}

export function getStoredActionOptions(options: unknown): StoredActionOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option, index) => {
      if (typeof option === "string" && option.trim()) {
        const identity = getActionOptionIdentity({
          fallbackId: `legacy-option-${index + 1}`,
        });
        return {
          ...identity,
          label: option.trim(),
          value: option.trim(),
        };
      }

      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return null;
      }

      const record = option as Record<string, unknown>;
      const label =
        typeof record.label === "string"
          ? record.label.trim()
          : typeof record.value === "string"
            ? record.value.trim()
            : "";
      const value = record.value;
      if (
        !label ||
        (typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean")
      ) {
        return null;
      }

      return {
        ...getActionOptionIdentity({
          fallbackId: `legacy-option-${index + 1}`,
          id: record.id,
        }),
        label,
        value,
      };
    })
    .filter((option): option is StoredActionOption => option !== null);
}
