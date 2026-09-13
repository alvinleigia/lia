import type { RuntimeInputRequest } from "@/lib/runtime-input-request";

export function shouldRenderActionStepInlineControl(input: {
  hasOptions: boolean;
  stepType: string;
}) {
  return input.hasOptions || input.stepType === "file_upload";
}

export function shouldRenderRuntimeInputControl(request: RuntimeInputRequest) {
  return (
    (request.inputKind === "choice" && request.options.length > 0) ||
    request.inputKind === "media" ||
    request.inputKind === "date"
  );
}

export function getBrowserComposerPlaceholder(input: {
  fallback: string;
  request: RuntimeInputRequest | null | undefined;
}) {
  if (input.request?.inputKind === "date") {
    return `Type ${input.request.label} or your full request...`;
  }
  if (!input.request || shouldRenderRuntimeInputControl(input.request)) {
    return input.fallback;
  }

  return `Enter ${input.request.label}${input.request.required ? " (required)" : ""}...`;
}
