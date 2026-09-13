import type { RuntimeInputRequest } from "@/lib/runtime-input-request";

export function shouldRenderActionStepInlineControl(input: {
  hasOptions: boolean;
  inputType?: string | null;
  stepType: string;
}) {
  return (
    input.hasOptions ||
    input.stepType === "file_upload" ||
    ["date", "time"].includes(input.inputType ?? input.stepType)
  );
}

export function shouldRenderRuntimeInputControl(request: RuntimeInputRequest) {
  return (
    (request.inputKind === "choice" && request.options.length > 0) ||
    request.inputKind === "media" ||
    request.inputKind === "date" ||
    request.inputKind === "time"
  );
}

export function getBrowserComposerPlaceholder(input: {
  fallback: string;
  request: RuntimeInputRequest | null | undefined;
}) {
  if (
    input.request?.inputKind === "date" ||
    input.request?.inputKind === "time"
  ) {
    return `Type ${input.request.label} or your full request...`;
  }
  if (!input.request || shouldRenderRuntimeInputControl(input.request)) {
    return input.fallback;
  }

  return `Enter ${input.request.label}${input.request.required ? " (required)" : ""}...`;
}
