export const ACTION_OPTION_OUTPUT_PORT_PREFIX = "option:";

export function buildActionOptionOutputPort(optionId: string) {
  return `${ACTION_OPTION_OUTPUT_PORT_PREFIX}${optionId}`;
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
