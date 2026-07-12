"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  archiveProjectMediaAsset,
  inferMediaType,
  MAX_MEDIA_UPLOAD_BYTES,
  saveProjectMediaFileUpload,
} from "@/lib/media-assets";

const mediaAssetIdSchema = z.coerce.number().int().positive();

function redirectWithError(message: string): never {
  redirect(`/projects/media?error=${encodeURIComponent(message)}`);
}

export async function uploadMediaAssetAction(formData: FormData) {
  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.documents.manage");

  const fileValue = formData.get("media");
  if (!(fileValue instanceof File)) {
    redirectWithError("Please choose a media file.");
  }
  const file = fileValue;

  if (file.size <= 0) {
    redirectWithError("Uploaded file is empty.");
  }

  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    redirectWithError("File is too large. Max size is 16 MB.");
  }

  const mimeType = file.type || "application/octet-stream";
  const originalName = file.name || "uploaded-file";
  const mediaType = inferMediaType(mimeType, originalName);
  if (!mediaType) {
    redirectWithError("Unsupported media type.");
  }

  const asset = await saveProjectMediaFileUpload({
    file,
    projectId: context.project.id,
    metadata: {
      source: "media_library",
    },
  });

  await writeAuditLog({
    ...context,
    action: "media_asset.uploaded",
    targetType: "media_asset",
    targetId: asset.id,
    metadata: {
      mediaType,
      mimeType,
      originalName,
      sizeBytes: file.size,
    },
  });

  revalidatePath("/projects/media");
  redirect("/projects/media?uploaded=1");
}

export async function archiveMediaAssetAction(formData: FormData) {
  const parsed = mediaAssetIdSchema.safeParse(formData.get("mediaAssetId"));
  if (!parsed.success) {
    redirectWithError("Invalid media asset.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.documents.manage");
  const asset = await archiveProjectMediaAsset(context.project.id, parsed.data);

  if (!asset) {
    redirectWithError("Media asset not found.");
  }

  await writeAuditLog({
    ...context,
    action: "media_asset.archived",
    targetType: "media_asset",
    targetId: asset.id,
    metadata: {
      mediaType: asset.mediaType,
      originalName: asset.originalName,
    },
  });

  revalidatePath("/projects/media");
  redirect("/projects/media?archived=1");
}
