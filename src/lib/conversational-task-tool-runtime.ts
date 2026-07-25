import type {
  ToolDefinitionV1,
  ToolResultMappingV1,
} from "@/lib/conversation-contracts";
import {
  canonicalizeTaskFieldValue,
  createToolOutputField,
} from "@/lib/conversational-task-field-validation";
import { resolveProjectTaskResource } from "@/lib/conversational-task-project-resources";

type RuntimeValue = {
  canonicalValue: unknown;
  state: string;
};

type RuntimeContextValue = {
  expiresAt: Date | null;
  value: unknown;
};

type ToolRuntimeError = {
  code: string;
  message: string;
};

export type CanonicalToolInputResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; error: ToolRuntimeError };

export type ValidatedToolResult =
  | {
      ok: true;
      mappings: Array<{ mapping: ToolResultMappingV1; value: unknown }>;
      result: Record<string, unknown>;
    }
  | { ok: false; error: ToolRuntimeError };

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readPath(value: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(key in current)
    ) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
}

function writePath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1) as string] = value;
}

export function buildCanonicalToolInput(input: {
  context: ReadonlyMap<string, RuntimeContextValue>;
  definition: ToolDefinitionV1;
  fields: ReadonlyMap<string, RuntimeValue>;
  now: Date;
  proposedInput: Record<string, unknown>;
}): CanonicalToolInputResult {
  const allowedKeys = new Set(
    input.definition.inputSchema.fields.map(({ key }) => key),
  );
  if (Object.keys(input.proposedInput).some((key) => !allowedKeys.has(key))) {
    return {
      error: {
        code: "tool_input_not_allowed",
        message: "The tool request included an input that is not allowed.",
      },
      ok: false,
    };
  }

  const canonical: Record<string, unknown> = {};
  for (const field of input.definition.inputSchema.fields) {
    let value: unknown;
    if (field.source.kind === "literal") {
      value = field.source.value;
    } else if (field.source.kind === "field") {
      const runtimeField = input.fields.get(field.source.key);
      if (
        runtimeField &&
        (runtimeField.state === "valid" || runtimeField.state === "confirmed")
      ) {
        value = runtimeField.canonicalValue;
      }
    } else {
      const contextValue = input.context.get(field.source.key);
      if (
        contextValue &&
        (!contextValue.expiresAt || contextValue.expiresAt > input.now)
      ) {
        value = contextValue.value;
      }
    }

    if ((value === undefined || value === null) && field.required) {
      return {
        error: {
          code: "tool_input_missing",
          message: `The required value "${field.key}" is not ready.`,
        },
        ok: false,
      };
    }
    if (value === undefined || value === null) continue;
    const proposed = input.proposedInput[field.key];
    if (proposed !== undefined && !valuesMatch(proposed, value)) {
      return {
        error: {
          code: "tool_input_mismatch",
          message: `The proposed value for "${field.key}" is not current.`,
        },
        ok: false,
      };
    }
    canonical[field.key] = value;
  }
  return { input: canonical, ok: true };
}

function resourceTypeForPath(path: string) {
  return path.toLowerCase().includes("catalog") ? "serviceCategory" : "service";
}

export async function validateToolResultPayload(input: {
  contextValues: ReadonlyMap<string, unknown>;
  definition: ToolDefinitionV1;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
  result: Record<string, unknown>;
}): Promise<ValidatedToolResult> {
  const sanitized: Record<string, unknown> = {};
  for (const output of input.definition.outputSchema.fields) {
    const value = readPath(input.result, output.path);
    if ((value === undefined || value === null) && output.required) {
      return {
        error: {
          code: "tool_output_missing",
          message: `The tool did not return "${output.path}".`,
        },
        ok: false,
      };
    }
    if (value === undefined || value === null) continue;
    const validation = await canonicalizeTaskFieldValue({
      contextValues: input.contextValues,
      field: createToolOutputField({
        key: "toolOutput",
        resourceType: resourceTypeForPath(output.path),
        type: output.type,
      }),
      fieldValues: input.fieldValues,
      projectId: input.projectId,
      resolveProjectResource: resolveProjectTaskResource,
      value,
    });
    if (!validation.ok) {
      return {
        error: {
          code: "tool_output_invalid",
          message: `The tool returned an invalid value for "${output.path}".`,
        },
        ok: false,
      };
    }
    writePath(sanitized, output.path, validation.value);
  }

  const mappings = input.definition.resultMappings.flatMap((mapping) => {
    const value = readPath(sanitized, mapping.sourcePath);
    return value === undefined ? [] : [{ mapping, value }];
  });
  return { mappings, ok: true, result: sanitized };
}
