// src/app/upload/actions.ts
"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import pdf from "pdf-parse";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import { db } from "@/lib/db-config";
import { sourceDocuments, uploadJobs } from "@/lib/db-schema";
import {
  deleteAllDocumentsFromProject,
  deleteSourceDocumentFromProject,
  getSourceDocumentByFileHash,
} from "@/lib/documents";
import { processUploadQueue } from "@/lib/upload-queue";

const MAX_DOCUMENT_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const SUPPORTED_TEXT_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
const SUPPORTED_TEXT_MIME_TYPES = [
  "text/markdown",
  "text/plain",
  "text/x-markdown",
] as const;

const projectIdSchema = z.coerce.number().int().positive();
const deleteDocumentSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  sourceDocumentId: z.coerce.number().int().positive(),
});

function isTextDocument(file: File, lowerName: string) {
  return (
    SUPPORTED_TEXT_EXTENSIONS.some((extension) =>
      lowerName.endsWith(extension),
    ) ||
    SUPPORTED_TEXT_MIME_TYPES.includes(
      file.type as (typeof SUPPORTED_TEXT_MIME_TYPES)[number],
    )
  );
}

function isPdfDocument(file: File, lowerName: string) {
  return file.type === "application/pdf" || lowerName.endsWith(".pdf");
}

export async function processDocumentFile(formData: FormData) {
  try {
    const context = await resolveUserAndProject(formData.get("projectId"));
    assertPermission(context.membership, "company.documents.manage");
    const file = (formData.get("document") ?? formData.get("pdf")) as File;

    if (!file) {
      return {
        success: false,
        error: "Please choose a document.",
      };
    }

    if (file.size <= 0) {
      return {
        success: false,
        error: "Uploaded file is empty.",
      };
    }

    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      return {
        success: false,
        error: "File is too large. Max size is 25 MB.",
      };
    }

    const lowerName = file.name.toLowerCase();
    const isPdf = isPdfDocument(file, lowerName);
    const isText = isTextDocument(file, lowerName);

    if (!isPdf && !isText) {
      return {
        success: false,
        error: "Only PDF, Markdown, and text files are supported.",
      };
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const duplicateDocument = await getSourceDocumentByFileHash(
      context.project.id,
      fileHash,
    );
    if (duplicateDocument) {
      return {
        success: false,
        error: `This document is already uploaded as "${duplicateDocument.title}".`,
      };
    }

    const textContent = isPdf
      ? (await pdf(buffer)).text
      : buffer.toString("utf8");

    if (!textContent || textContent.trim().length === 0) {
      return {
        success: false,
        error: "No text found in document.",
      };
    }

    let sourceDocumentId: number | null = null;
    await db.transaction(async (tx) => {
      const [uploadedDocument] = await tx
        .insert(sourceDocuments)
        .values({
          projectId: context.project.id,
          title: file.name || "Uploaded Document",
          fileHash,
          processingStatus: "queued",
          processingError: null,
          processedAt: null,
          mimeType: file.type || null,
          sizeBytes: Number.isFinite(file.size) ? file.size : null,
        })
        .returning();
      sourceDocumentId = uploadedDocument.id;

      await tx.insert(uploadJobs).values({
        projectId: context.project.id,
        sourceDocumentId: uploadedDocument.id,
        textContent,
        status: "queued",
      });
    });
    await writeAuditLog({
      ...context,
      action: "document.upload_queued",
      targetType: "source_document",
      targetId: sourceDocumentId,
      metadata: {
        mimeType: file.type || null,
        sizeBytes: file.size,
        title: file.name || "Uploaded Document",
      },
    });

    return {
      success: true,
      message:
        "Document queued for background processing. It will appear in chat after indexing completes.",
    };
  } catch (error) {
    console.error("PDF processing error:", error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return {
        success: false,
        error: "This document was already uploaded to the selected project.",
      };
    }

    return {
      success: false,
      error: "Failed to process document",
    };
  }
}

export const processPdfFile = processDocumentFile;

export async function deleteSourceDocumentFromUploadAction(formData: FormData) {
  const parsed = deleteDocumentSchema.safeParse({
    projectId: formData.get("projectId"),
    sourceDocumentId: formData.get("sourceDocumentId"),
  });
  if (!parsed.success) {
    redirect(
      "/projects/documents?error=Invalid%20document%20delete%20request.",
    );
  }

  const context = await resolveUserAndProject(parsed.data.projectId);
  assertPermission(context.membership, "company.documents.manage");
  await deleteSourceDocumentFromProject(
    context.project.id,
    parsed.data.sourceDocumentId,
  );
  await writeAuditLog({
    ...context,
    action: "document.deleted",
    targetType: "source_document",
    targetId: parsed.data.sourceDocumentId,
  });

  revalidatePath("/projects/documents");
  redirect("/projects/documents?deleted=1");
}

export async function deleteAllDocumentsFromUploadAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects/documents?error=Invalid%20project%20for%20delete.");
  }

  const context = await resolveUserAndProject(parsed.data);
  assertPermission(context.membership, "company.documents.manage");
  await deleteAllDocumentsFromProject(context.project.id);
  await writeAuditLog({
    ...context,
    action: "documents.deleted_all",
    targetType: "project",
    targetId: context.project.id,
  });

  revalidatePath("/projects/documents");
  redirect("/projects/documents?deletedAll=1");
}

export async function processQueuedDocumentsAction(formData: FormData) {
  const parsed = projectIdSchema.safeParse(formData.get("projectId"));
  if (!parsed.success) {
    redirect("/projects/documents?error=Invalid%20project%20for%20processing.");
  }

  await resolveUserAndProject(parsed.data);

  let result: Awaited<ReturnType<typeof processUploadQueue>>;
  try {
    result = await processUploadQueue(10);
  } catch (error) {
    console.error("Queue processing action failed:", error);
    redirect(
      "/projects/documents?error=Failed%20to%20process%20queued%20documents.",
    );
  }

  revalidatePath("/projects/documents");
  redirect(
    `/projects/documents?processed=${result.processed}&failed=${result.failed}&idle=${result.idle ? "1" : "0"}`,
  );
}
