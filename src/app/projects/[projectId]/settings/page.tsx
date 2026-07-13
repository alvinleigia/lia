import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Save,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canAccess } from "@/lib/access-control";
import { getProjectForWorkspaceById } from "@/lib/projects";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import {
  archiveProjectAction,
  renameProjectAction,
  unarchiveProjectAction,
} from "../../actions";

type ProjectSettingsPageProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    archived?: string;
    renamed?: string;
    unarchived?: string;
    error?: string;
  }>;
};

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: ProjectSettingsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const parsedProjectId = Number(projectId);

  if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
    notFound();
  }

  const context = await resolvePageUserAndWorkspace();
  const project = await getProjectForWorkspaceById(
    parsedProjectId,
    context.workspace.id,
    true,
  );

  if (!project) {
    notFound();
  }

  const canManageProject = canAccess(
    context.membership,
    "company.project.manage",
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href={project.isArchived ? "/projects" : `/projects/${project.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {project.isArchived ? "Back to projects" : "Back to project"}
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Project Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.renamed === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project renamed.
              </p>
            )}
            {query.archived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project archived and widget disabled.
              </p>
            )}
            {query.unarchived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project unarchived.
              </p>
            )}
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}

            <form action={renameProjectAction} className="space-y-4">
              <input type="hidden" name="projectId" value={project.id} />
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  name="name"
                  defaultValue={project.name}
                  required
                />
              </div>
              <FormSubmitButton
                label="Save Project"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Archive className="h-6 w-6" />
              Project Availability
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <p className="mt-1 font-medium">
                {project.isArchived ? "Archived" : "Available"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {project.isArchived
                  ? "Unarchive this project to make it available for chat, widget, channels, and automation."
                  : "Archive this project to hide it from active project flows and disable its widget token."}
              </p>
            </div>

            {canManageProject ? (
              project.isArchived ? (
                <form action={unarchiveProjectAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input
                    type="hidden"
                    name="redirectTo"
                    value={`/projects/${project.id}/settings`}
                  />
                  <FormSubmitButton
                    label="Unarchive Project"
                    pendingLabel="Updating..."
                    variant="outline"
                    icon={<RotateCcw className="h-4 w-4" />}
                  />
                </form>
              ) : (
                <form action={archiveProjectAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input
                    type="hidden"
                    name="redirectTo"
                    value={`/projects/${project.id}/settings`}
                  />
                  <FormSubmitButton
                    label="Archive Project"
                    pendingLabel="Archiving..."
                    variant="outline"
                    icon={<Archive className="h-4 w-4" />}
                  />
                </form>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                You do not have permission to change project availability.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
