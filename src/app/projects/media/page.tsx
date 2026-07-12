import { Archive, FileImage, UploadCloud } from "lucide-react";
import Link from "next/link";
import {
  archiveMediaAssetAction,
  uploadMediaAssetAction,
} from "@/app/projects/media/actions";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import {
  listProjectMediaAssets,
  MAX_MEDIA_UPLOAD_BYTES,
} from "@/lib/media-assets";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type MediaPageProps = {
  searchParams: Promise<{
    archived?: string;
    error?: string;
    uploaded?: string;
  }>;
};

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: Date) {
  return value.toLocaleString();
}

export default async function ProjectMediaPage({
  searchParams,
}: MediaPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Media needs a project" />;
  }

  const { project } = context;
  const assets = await listProjectMediaAssets(project.id);
  const maxUploadMb = Math.floor(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024));

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <FileImage className="h-6 w-6" />
              Media Library: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.uploaded === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Media asset uploaded.
              </p>
            )}
            {params.archived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Media asset archived.
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              Store reusable images, videos, audio, PDFs, and common files for
              this project. These assets are the foundation for future Media and
              Ask Media flow blocks across widget, WhatsApp, and other channels.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active Assets
                </p>
                <p className="text-xl font-semibold">{assets.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Upload Limit
                </p>
                <p className="text-xl font-semibold">{maxUploadMb} MB</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Storage
                </p>
                <p className="text-xl font-semibold">Local</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <UploadCloud className="h-5 w-5" />
              Upload Media
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={uploadMediaAssetAction} className="space-y-4">
              <input type="hidden" name="projectId" value={project.id} />
              <div className="space-y-2">
                <label htmlFor="media" className="text-sm font-medium">
                  File
                </label>
                <Input
                  id="media"
                  name="media"
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Supported: image, video, audio, PDF, text, CSV, JSON, and
                  common Office files up to {maxUploadMb} MB.
                </p>
              </div>
              <FormSubmitButton
                label="Upload Asset"
                pendingLabel="Uploading..."
                icon={<UploadCloud className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Assets</CardTitle>
          </CardHeader>
          <CardContent>
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No media assets uploaded yet.
              </p>
            ) : (
              <div className="space-y-3">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="rounded-md border bg-white px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium">
                            {asset.originalName}
                          </p>
                          <span className="rounded-md border px-2 py-1 text-xs capitalize">
                            {asset.mediaType}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {asset.mimeType} · {formatBytes(asset.sizeBytes)} ·
                          Uploaded {formatDate(asset.createdAt)}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {asset.publicPath}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button asChild variant="outline">
                          <Link href={asset.publicPath} target="_blank">
                            Open
                          </Link>
                        </Button>
                        <form action={archiveMediaAssetAction}>
                          <input
                            type="hidden"
                            name="projectId"
                            value={project.id}
                          />
                          <input
                            type="hidden"
                            name="mediaAssetId"
                            value={asset.id}
                          />
                          <FormSubmitButton
                            label="Archive"
                            pendingLabel="Archiving..."
                            variant="outline"
                            icon={<Archive className="h-4 w-4" />}
                          />
                        </form>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
