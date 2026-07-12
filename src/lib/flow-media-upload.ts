import {
  addActionSubmissionEvent,
  getActionFlowStep,
  getActionSubmission,
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

export class FlowMediaUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FlowMediaUploadError";
    this.status = status;
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
  formData: FormData;
  projectId: number;
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
  if (!submission || submission.status !== "in_progress") {
    throw new FlowMediaUploadError("Flow submission not found.", 404);
  }

  if (submission.actionId === null) {
    throw new FlowMediaUploadError("Flow action is unavailable.", 404);
  }

  const step = await getActionFlowStep(
    input.projectId,
    submission.actionId,
    stepId,
  );
  if (!step || step.stepType !== "file_upload" || !step.isEnabled) {
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

  let asset: Awaited<ReturnType<typeof saveProjectMediaFileUpload>>;

  try {
    asset = await saveProjectMediaFileUpload({
      file,
      projectId: input.projectId,
      metadata: {
        actionId: submission.actionId,
        source: "flow_upload",
        stepId,
        submissionId,
        submissionSource: submission.source,
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

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: submission.id,
    eventType: "flow.media_uploaded",
    message: "Media uploaded for flow step.",
    payload: {
      actionId: submission.actionId,
      mediaAssetId: asset.id,
      stepId,
      value,
    },
  });

  const channelType = getChannelTypeForSubmissionSource(submission.source);
  if (channelType && submission.conversationId) {
    await recordChannelInboundMessage({
      projectId: input.projectId,
      channelType,
      externalConversationId: submission.conversationId,
      text: asset.originalName,
      messageType: asset.mediaType,
      payload: {
        event: "flow.media_uploaded",
        mediaAsset: value,
        stepId,
        submissionId: submission.id,
      },
    });
  }

  return {
    label: `Uploaded ${asset.originalName}`,
    value,
  };
}
