import { Files, ListChecks, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteAllDocumentsFromUploadAction,
  deleteSourceDocumentFromUploadAction,
  processQueuedDocumentsAction,
} from "@/app/upload/actions";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { UploadFormClient } from "@/components/upload-form-client";
import {
  getProjectDocumentStats,
  getProjectSourceDocuments,
} from "@/lib/documents";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type DocumentsPageProps = {
  searchParams: Promise<{
    error?: string;
    deleted?: string;
    deletedAll?: string;
    processed?: string;
    failed?: string;
    idle?: string;
  }>;
};

export default async function ProjectDocumentsPage({
  searchParams,
}: DocumentsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Documents need a project" />;
  }

  const { project: selectedProject } = context;
  const documentStats = await getProjectDocumentStats(selectedProject.id);
  const sourceDocumentList = await getProjectSourceDocuments(
    selectedProject.id,
    50,
  );
  const queuedDocumentCount = sourceDocumentList.filter(
    (doc) => doc.processingStatus === "queued",
  ).length;
  const processedCount = Number(params.processed ?? "0");
  const failedCount = Number(params.failed ?? "0");
  const wasIdle = params.idle === "1";

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              <Files className="h-6 w-6 inline mr-2" />
              Documents: {selectedProject.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.deleted === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Document deleted.
              </p>
            )}
            {params.deletedAll === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                All documents deleted for selected project.
              </p>
            )}
            {processedCount > 0 && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Processed {processedCount} queued document
                {processedCount === 1 ? "" : "s"}.
              </p>
            )}
            {failedCount > 0 && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {failedCount} queued document
                {failedCount === 1 ? "" : "s"} failed during processing.
              </p>
            )}
            {wasIdle && processedCount === 0 && failedCount === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">
                No queued documents were waiting to be processed.
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              Supported files: PDF, Markdown, and plain text.
            </p>

            <p className="text-sm text-muted-foreground">
              Total uploaded documents: {documentStats.totalDocuments}
            </p>
            <p className="text-sm text-muted-foreground">
              Total chunks indexed: {documentStats.totalChunks}
            </p>
            {documentStats.legacyChunks > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2">
                {documentStats.legacyChunks} legacy chunks exist from older
                uploads before document grouping.
              </p>
            )}

            {queuedDocumentCount > 0 && (
              <form action={processQueuedDocumentsAction}>
                <input
                  type="hidden"
                  name="projectId"
                  value={selectedProject.id}
                />
                <FormSubmitButton
                  label={`Process Queued Documents (${queuedDocumentCount})`}
                  pendingLabel="Processing..."
                  icon={<RefreshCw className="h-4 w-4" />}
                />
              </form>
            )}

            {sourceDocumentList.length > 0 && (
              <form action={deleteAllDocumentsFromUploadAction}>
                <input
                  type="hidden"
                  name="projectId"
                  value={selectedProject.id}
                />
                <FormSubmitButton
                  label="Delete All Documents in This Project"
                  pendingLabel="Deleting..."
                  variant="destructive"
                  icon={<Trash2 className="h-4 w-4" />}
                />
              </form>
            )}

            {sourceDocumentList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents uploaded yet for this project.
              </p>
            ) : (
              <div className="space-y-2">
                {sourceDocumentList.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-md border bg-white px-4 py-3 text-sm flex items-start justify-between gap-4"
                  >
                    <div>
                      <p className="font-medium">{doc.title}</p>
                      <p className="text-muted-foreground">
                        {Number(doc.chunkCount)} chunks
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Status:{" "}
                        {doc.processingStatus === "queued"
                          ? "queued for indexing"
                          : doc.processingStatus}
                      </p>
                      {doc.processingError && (
                        <p className="text-xs text-red-600">
                          {doc.processingError}
                        </p>
                      )}
                    </div>
                    <form action={deleteSourceDocumentFromUploadAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={selectedProject.id}
                      />
                      <input
                        type="hidden"
                        name="sourceDocumentId"
                        value={doc.id}
                      />
                      <FormSubmitButton
                        label="Delete"
                        pendingLabel="Deleting..."
                        variant="destructive"
                        icon={<Trash2 className="h-4 w-4" />}
                      />
                    </form>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              Source Quality
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-white px-4 py-3">
                <p className="font-medium">Precise Facts</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Q&A, pricing, contacts, locations, policies, and project facts
                  work best.
                </p>
              </div>
              <div className="rounded-md border bg-white px-4 py-3">
                <p className="font-medium">Current Details</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keep phone numbers, availability, payment plans, and status
                  notes updated.
                </p>
              </div>
              <div className="rounded-md border bg-white px-4 py-3">
                <p className="font-medium">Clear Boundaries</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add restrictions in Project Settings when answers must stay
                  short or avoid advice.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <UploadFormClient
          projectId={selectedProject.id}
          projectName={selectedProject.name}
        />
      </div>
    </div>
  );
}
