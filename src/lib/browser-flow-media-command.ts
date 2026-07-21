import { createHash } from "node:crypto";
import { getActionSubmission } from "@/lib/action-flows";
import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";
import {
  BrowserFlowCommandError,
  runBrowserFlowMedia,
} from "@/lib/browser-flow-runtime";
import type { ChannelType } from "@/lib/channels";
import {
  FlowMediaUploadError,
  uploadActionFlowMedia,
} from "@/lib/flow-media-upload";
import type { FlowMediaUploadValue } from "@/lib/flow-media-values";
import {
  claimFlowRuntimeCommand,
  completeFlowRuntimeCommand,
  failFlowRuntimeCommand,
} from "@/lib/flow-runtime-commands";

export type BrowserFlowMediaCommandResult = BrowserFlowRuntimeResult & {
  label: string;
  revision: number;
  submissionId: number;
  value: FlowMediaUploadValue;
};

function readRequiredText(formData: FormData, key: string, label: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new FlowMediaUploadError(`${label} is required.`);
  }
  return value.trim();
}

function readPositiveInteger(formData: FormData, key: string, label: string) {
  const value = Number(readRequiredText(formData, key, label));
  if (!Number.isInteger(value) || value <= 0) {
    throw new FlowMediaUploadError(`${label} is invalid.`);
  }
  return value;
}

function readNonNegativeInteger(
  formData: FormData,
  key: string,
  label: string,
) {
  const value = Number(readRequiredText(formData, key, label));
  if (!Number.isInteger(value) || value < 0) {
    throw new FlowMediaUploadError(`${label} is invalid.`);
  }
  return value;
}

async function hashMediaCommand(input: {
  expectedRevision: number;
  file: File;
  stepId: number;
  submissionId: number;
}) {
  const fileHash = createHash("sha256")
    .update(new Uint8Array(await input.file.arrayBuffer()))
    .digest("hex");

  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedRevision: input.expectedRevision,
        fileHash,
        fileName: input.file.name,
        fileSize: input.file.size,
        fileType: input.file.type,
        stepId: input.stepId,
        submissionId: input.submissionId,
      }),
    )
    .digest("hex");
}

export async function runBrowserFlowMediaCommand(input: {
  channelType: ChannelType;
  formData: FormData;
  projectId: number;
  source: "project_chat" | "widget_chat";
}): Promise<BrowserFlowMediaCommandResult> {
  const commandId = readRequiredText(input.formData, "commandId", "Command ID");
  const expectedRevision = readNonNegativeInteger(
    input.formData,
    "expectedRevision",
    "Flow revision",
  );
  const submissionId = readPositiveInteger(
    input.formData,
    "submissionId",
    "Submission",
  );
  const stepId = readPositiveInteger(input.formData, "stepId", "Step");
  const file = input.formData.get("file");
  if (!(file instanceof File)) {
    throw new FlowMediaUploadError("Please choose a file.");
  }

  const submission = await getActionSubmission(input.projectId, submissionId);
  if (
    !submission ||
    submission.source !== input.source ||
    !submission.conversationId
  ) {
    throw new FlowMediaUploadError("Flow submission not found.", 404);
  }

  const claim = await claimFlowRuntimeCommand<BrowserFlowMediaCommandResult>({
    commandId,
    conversationId: submission.conversationId,
    projectId: input.projectId,
    requestHash: await hashMediaCommand({
      expectedRevision,
      file,
      stepId,
      submissionId,
    }),
    source: input.source,
    traceId: submission.traceId,
  });

  if (claim.state === "replay") {
    return claim.result;
  }

  if (claim.state !== "claimed") {
    const messages = {
      conflict: "This command ID was already used for another request.",
      failed: "The previous attempt for this upload failed.",
      processing: "This upload is already being processed.",
    } as const;
    throw new FlowMediaUploadError(messages[claim.state], 409, claim.state);
  }

  try {
    const upload = await uploadActionFlowMedia({
      expectedRevision,
      formData: input.formData,
      projectId: input.projectId,
      source: input.source,
    });
    const runtime = await runBrowserFlowMedia({
      channelType: input.channelType,
      expectedRevision: upload.revision,
      media: upload.value,
      projectId: input.projectId,
      source: input.source,
      submissionId: upload.submissionId,
    });
    const result = { ...upload, ...runtime };

    await completeFlowRuntimeCommand({
      commandId: claim.commandId,
      projectId: input.projectId,
      result,
    });
    return result;
  } catch (error) {
    await failFlowRuntimeCommand({
      commandId: claim.commandId,
      errorMessage: error instanceof Error ? error.message : "Upload failed.",
      projectId: input.projectId,
    });
    if (error instanceof BrowserFlowCommandError) {
      throw new FlowMediaUploadError(error.message, 409, error.code);
    }
    throw error;
  }
}
