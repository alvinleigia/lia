import { ArrowLeft, CheckCircle2, Save, Settings } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveStrictPageUserAndProject } from "@/lib/protected-page";
import { renameProjectAction } from "../../actions";

type ProjectSettingsPageProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    renamed?: string;
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

  let projectContext: Awaited<
    ReturnType<typeof resolveStrictPageUserAndProject>
  >;
  try {
    projectContext = await resolveStrictPageUserAndProject(parsedProjectId);
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") {
      notFound();
    }

    throw error;
  }

  const { project } = projectContext;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to project
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
      </div>
    </div>
  );
}
