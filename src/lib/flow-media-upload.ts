import {
  getActionSubmission,
  reserveActionSubmissionRevision,
} from "@/lib/action-flows";
import { type ChannelType, recordChannelInboundMessage } from "@/lib/channels";
import {
  doesFileMatchAllowedFileTypes,
  getInvalidAllowedFileTypeTokens,
} from "@/lib/flow-file-validation";
import type { FlowMediaUploadValue } from "@/lib/flow-media-values";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  saveProjectMediaFileUpload,
} from "@/lib/media-assets";
import { getRuntimeProjectActionForSubmission } from "@/lib/runtime-actions";

export class FlowMediaUploadError extends Error {
  code?: "conflict" | "failed" | "processing" | "stale";
  status: number;

  constructor(
    message: string,
    status = 400,
    code?: "conflict" | "failed" | "processing" | "stale",
  ) {
    super(message);
    this.name = "FlowMediaUploadError";
    this.status = status;
    this.code = code;
  }
}

function readPositiveInteger(value: FormDataEntryValue | null, label: string) {
  const parsed =
    typeof value === "string" && value.trim() !== "" ? Number(value) : null;

  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new FlowMediaUploadError(`${label} is invalid.`);
  }

  return parsed;
}

function getChannelTypeForSubmissionSource(source: string): ChannelType | null {
  if (source === "project_chat") {
    return "project_chat";
  }

  if (source === "widget_chat") {
    return "widget";
  }

  return null;
}

export async function uploadActionFlowMedia(input: {
  expectedRevision: number;
  formData: FormData;
  projectId: number;
  source: "project_chat" | "widget_chat";
}) {
  const submissionId = readPositiveInteger(
    input.formData.get("submissionId"),
    "Submission",
  );
  const stepId = readPositiveInteger(input.formData.get("stepId"), "Step");
  const file = input.formData.get("file");

  if (!(file instanceof File)) {
    throw new FlowMediaUploadError("Please choose a file.");
  }

  if (file.size <= 0) {
    throw new FlowMediaUploadError("Uploaded file is empty.");
  }

  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new FlowMediaUploadError("File is too large. Max size is 16 MB.");
  }

  const submission = await getActionSubmission(input.projectId, submissionId);
  if (
    !submission ||
    submission.status !== "in_progress" ||
    submission.source !== input.source
  ) {
    throw new FlowMediaUploadError("Flow submission not found.", 404);
  }

  if (submission.actionId === null) {
    throw new FlowMediaUploadError("Flow action is unavailable.", 404);
  }

  const action = await getRuntimeProjectActionForSubmission(
    input.projectId,
    submission,
  );
  const step = action?.steps.find((item) => item.id === stepId);
  if (
    !step ||
    step.id !== submission.currentStepId ||
    step.stepType !== "file_upload" ||
    !step.isEnabled
  ) {
    throw new FlowMediaUploadError("Flow media step is unavailable.", 404);
  }

  const allowedFileTypes =
    typeof step.settings.validationAllowedFileTypes === "string"
      ? step.settings.validationAllowedFileTypes
      : "";
  const invalidAllowedFileTypes =
    getInvalidAllowedFileTypeTokens(allowedFileTypes);

  if (invalidAllowedFileTypes.length > 0) {
    throw new FlowMediaUploadError(
      "This upload step has invalid file type settings.",
    );
  }

  if (!doesFileMatchAllowedFileTypes(file, allowedFileTypes)) {
    throw new FlowMediaUploadError(
      "This file type is not allowed for this step.",
    );
  }

  const reservedSubmission = await reserveActionSubmissionRevision({
    expectedRevision: input.expectedRevision,
    projectId: input.projectId,
    submissionId,
  });
  if (!reservedSubmission) {
    throw new FlowMediaUploadError(
      "This flow changed in another request. Refresh and try again.",
      409,
      "stale",
    );
  }

  let asset: Awaited<ReturnType<typeof saveProjectMediaFileUpload>>;

  try {
    asset = await saveProjectMediaFileUpload({
      file,
      projectId: input.projectId,
      metadata: {
        actionId: reservedSubmission.actionId,
        source: "flow_upload",
        stepId,
        submissionId,
        submissionSource: reservedSubmission.source,
      },
    });
  } catch {
    throw new FlowMediaUploadError("Unsupported media type.");
  }
  const value: FlowMediaUploadValue = {
    mediaAssetId: asset.id,
    mediaType: asset.mediaType,
    mimeType: asset.mimeType,
    originalName: asset.originalName,
    provider: "local",
    publicPath: asset.publicPath,
    sizeBytes: asset.sizeBytes,
  };

  const channelType = getChannelTypeForSubmissionSource(
    reservedSubmission.source,
  );
  if (channelType && reservedSubmission.conversationId) {
    await recordChannelInboundMessage({
      projectId: input.projectId,
      channelType,
      externalConversationId: reservedSubmission.conversationId,
      text: asset.originalName,
      messageType: asset.mediaType,
      payload: {
        event: "flow.media_uploaded",
        mediaAsset: value,
        stepId,
        submissionId: reservedSubmission.id,
      },
    });
  }

  return {
    label: `Uploaded ${asset.originalName}`,
    revision: reservedSubmission.revision,
    submissionId: reservedSubmission.id,
    value,
  };
}
