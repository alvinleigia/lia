export type WhatsAppTemplateMetadataIssue = {
  code:
    | "body_parameter_sequence"
    | "body_variable_count"
    | "missing_body_sample";
  message: string;
  severity: "info" | "warning";
};

export function extractWhatsAppTemplateBodyParameterIndexes(body: string) {
  const indexes = new Set<number>();
  const pattern = /\{\{\s*(\d+)\s*\}\}/g;
  let match = pattern.exec(body);

  while (match) {
    const index = Number(match[1]);

    if (Number.isInteger(index) && index > 0) {
      indexes.add(index);
    }

    match = pattern.exec(body);
  }

  return [...indexes].sort((left, right) => left - right);
}

export function getWhatsAppTemplateMetadataIssues(input: {
  body?: string | null;
  status?: string | null;
  variables?: string[] | null;
}): WhatsAppTemplateMetadataIssue[] {
  const body = input.body?.trim() ?? "";
  const variables = input.variables ?? [];

  if (!body) {
    return input.status === "approved"
      ? [
          {
            code: "missing_body_sample",
            message:
              "Approved template steps should store the Meta body sample so variables can be checked before publishing.",
            severity: "info",
          },
        ]
      : [];
  }

  const indexes = extractWhatsAppTemplateBodyParameterIndexes(body);
  const expectedIndexes = Array.from(
    { length: indexes.length },
    (_, index) => index + 1,
  );
  const hasSequentialIndexes = indexes.every(
    (index, position) => index === expectedIndexes[position],
  );
  const issues: WhatsAppTemplateMetadataIssue[] = [];

  if (!hasSequentialIndexes) {
    issues.push({
      code: "body_parameter_sequence",
      message:
        "Template body placeholders should be sequential, for example {{1}}, {{2}}, {{3}}.",
      severity: "warning",
    });
  }

  if (indexes.length !== variables.length) {
    issues.push({
      code: "body_variable_count",
      message: `Template body expects ${indexes.length} variable(s), but ${variables.length} body variable value(s) are configured.`,
      severity: "warning",
    });
  }

  return issues;
}

export function renderWhatsAppTemplateBodyPreview(
  body: string | null | undefined,
  variables: string[],
) {
  if (!body?.trim()) {
    return null;
  }

  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (placeholder, rawIndex) => {
    const index = Number(rawIndex) - 1;
    return variables[index] ?? placeholder;
  });
}
