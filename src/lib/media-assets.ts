import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { type InsertMediaAsset, mediaAssets } from "@/lib/db-schema";

export const MAX_MEDIA_UPLOAD_BYTES = 16 * 1024 * 1024;

const SUPPORTED_FILE_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const SUPPORTED_FILE_EXTENSIONS = [
  ".csv",
  ".doc",
  ".docx",
  ".json",
  ".md",
  ".pdf",
  ".ppt",
  ".pptx",
  ".txt",
  ".xls",
  ".xlsx",
] as const;

export function inferMediaType(mimeType: string, fileName: string) {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedName = fileName.toLowerCase();

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }

  if (normalizedMime.startsWith("video/")) {
    return "video";
  }

  if (normalizedMime.startsWith("audio/")) {
    return "audio";
  }

  if (
    SUPPORTED_FILE_MIME_TYPES.has(normalizedMime) ||
    SUPPORTED_FILE_EXTENSIONS.some((extension) =>
      normalizedName.endsWith(extension),
    )
  ) {
    return "file";
  }

  return null;
}

export function sanitizeMediaFileName(fileName: string) {
  const sanitized = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 140);

  return sanitized || "uploaded-file";
}

export async function createMediaAsset(input: InsertMediaAsset) {
  const [asset] = await db.insert(mediaAssets).values(input).returning();
  return asset;
}

export async function saveProjectMediaBytes(input: {
  bytes: Buffer;
  metadata?: Record<string, unknown>;
  mimeType: string;
  originalName: string;
  projectId: number;
}) {
  const mediaType = inferMediaType(input.mimeType, input.originalName);

  if (!mediaType) {
    throw new Error("Unsupported media type.");
  }

  if (input.bytes.byteLength <= 0) {
    throw new Error("Media file is empty.");
  }

  if (input.bytes.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error("File is too large. Max size is 16 MB.");
  }

  const safeName = sanitizeMediaFileName(input.originalName);
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  const fileName = `${baseName}-${randomUUID()}${extension}`;
  const projectStoragePath = path.join(
    "uploads",
    "media",
    String(input.projectId),
  );
  const storageKey = path
    .join(projectStoragePath, fileName)
    .replace(/\\/g, "/");
  const uploadDirectory = path.join(
    process.cwd(),
    "public",
    projectStoragePath,
  );
  const diskPath = path.join(uploadDirectory, fileName);
  const publicPath = `/${storageKey}`;

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(diskPath, input.bytes);

  return createMediaAsset({
    projectId: input.projectId,
    fileName,
    originalName: input.originalName,
    mediaType,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    storageKey,
    publicPath,
    status: "active",
    metadata: {
      ...(input.metadata ?? {}),
      storage: "local-public",
    },
  });
}

export async function saveProjectMediaFileUpload(input: {
  file: File;
  metadata?: Record<string, unknown>;
  projectId: number;
}) {
  const mimeType = input.file.type || "application/octet-stream";
  const originalName = input.file.name || "uploaded-file";
  const mediaType = inferMediaType(mimeType, originalName);

  if (!mediaType) {
    throw new Error("Unsupported media type.");
  }

  return saveProjectMediaBytes({
    bytes: Buffer.from(await input.file.arrayBuffer()),
    metadata: input.metadata,
    mimeType,
    originalName,
    projectId: input.projectId,
  });
}

export async function listProjectMediaAssets(projectId: number, limit = 100) {
  return db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.projectId, projectId),
        eq(mediaAssets.status, "active"),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(limit);
}

export async function getProjectMediaAsset(
  projectId: number,
  mediaAssetId: number,
) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.projectId, projectId),
        eq(mediaAssets.id, mediaAssetId),
        eq(mediaAssets.status, "active"),
      ),
    )
    .limit(1);

  return asset ?? null;
}

export async function archiveProjectMediaAsset(
  projectId: number,
  mediaAssetId: number,
) {
  const [asset] = await db
    .update(mediaAssets)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaAssets.projectId, projectId),
        eq(mediaAssets.id, mediaAssetId),
      ),
    )
    .returning();

  return asset ?? null;
}
