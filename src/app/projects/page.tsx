import { Archive, FolderKanban, Plus, RotateCcw, Settings } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { listProjectsForWorkspace } from "@/lib/projects";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import {
  archiveProjectAction,
  setActiveProjectAction,
  unarchiveProjectAction,
} from "./actions";

type ProjectsPageProps = {
  searchParams: Promise<{
    created?: string;
    archived?: string;
    unarchived?: string;
    error?: string;
  }>;
};

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const params = await searchParams;
  const { company, workspace } = await resolvePageUserAndWorkspace();
  const projects = await listProjectsForWorkspace(workspace.id);
  const availableProjects = projects.filter((project) => !project.isArchived);
  const archivedProjects = projects.filter((project) => project.isArchived);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <FolderKanban className="h-6 w-6" />
                Projects
              </CardTitle>
              <Button asChild>
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" />
                  New Project
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Manage chatbot projects for {company.name}. Project selection is
              handled from the header badge.
            </p>

            {params.created === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Project created.
              </p>
            )}
            {params.archived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Project archived and widget disabled.
              </p>
            )}
            {params.unarchived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Project unarchived.
              </p>
            )}
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Available Projects
              </p>
              {availableProjects.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No available projects.
                </p>
              )}
              {availableProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between rounded-md border bg-white px-4 py-3"
                >
                  <form action={setActiveProjectAction} className="flex-1">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input
                      type="hidden"
                      name="redirectTo"
                      value={`/projects/${project.id}`}
                    />
                    <button
                      type="submit"
                      className="w-full text-left rounded-md px-1 py-1 hover:bg-accent/50"
                    >
                      <p className="font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {project.id}
                      </p>
                    </button>
                  </form>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline">
                      <Link href={`/projects/${project.id}/settings`}>
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                    </Button>
                    <form action={archiveProjectAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={project.id}
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
              ))}
            </div>

            <div className="space-y-2 pt-3 border-t">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Archived Projects
              </p>
              {archivedProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No archived projects.
                </p>
              ) : (
                archivedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-md border bg-white px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {project.id}
                      </p>
                    </div>
                    <form action={unarchiveProjectAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={project.id}
                      />
                      <FormSubmitButton
                        label="Unarchive"
                        pendingLabel="Updating..."
                        variant="outline"
                        icon={<RotateCcw className="h-4 w-4" />}
                      />
                    </form>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
