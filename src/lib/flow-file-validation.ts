export const DEFAULT_FLOW_FILE_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function parseAllowedFileTypeTokens(value: string | null | undefined) {
  return (
    value
      ?.split(",")
      .map((token) => token.trim())
      .filter(Boolean) ?? []
  );
}

export function isValidAllowedFileTypeToken(value: string) {
  return (
    /^\.[a-z0-9][a-z0-9+-]{0,31}$/i.test(value) ||
    /^[a-z0-9][a-z0-9.+-]*\/(?:[a-z0-9][a-z0-9.+-]*|\*)$/i.test(value)
  );
}

export function getInvalidAllowedFileTypeTokens(
  value: string | null | undefined,
) {
  return parseAllowedFileTypeTokens(value).filter(
    (token) => !isValidAllowedFileTypeToken(token),
  );
}

export function getFlowFileAcceptAttribute(value: string | null | undefined) {
  const tokens = parseAllowedFileTypeTokens(value).filter(
    isValidAllowedFileTypeToken,
  );

  return tokens.length > 0 ? tokens.join(",") : DEFAULT_FLOW_FILE_ACCEPT;
}

export function doesFileMatchAllowedFileTypes(
  file: File,
  value: string | null | undefined,
) {
  const tokens = parseAllowedFileTypeTokens(value);

  if (tokens.length === 0) {
    return true;
  }

  const normalizedName = file.name.toLowerCase();
  const normalizedMime = file.type.toLowerCase();

  return tokens.some((token) => {
    const normalizedToken = token.toLowerCase();

    if (normalizedToken.startsWith(".")) {
      return normalizedName.endsWith(normalizedToken);
    }

    if (normalizedToken.endsWith("/*")) {
      return normalizedMime.startsWith(normalizedToken.slice(0, -1));
    }

    return normalizedMime === normalizedToken;
  });
}
