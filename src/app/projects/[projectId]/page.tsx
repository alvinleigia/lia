import {
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  PlugZap,
  Settings,
  Upload,
  WandSparkles,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveStrictUserAndProject } from "@/lib/auth-project";

type ProjectLandingPageProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    created?: string;
    renamed?: string;
  }>;
};

export default async function ProjectLandingPage({
  params,
  searchParams,
}: ProjectLandingPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const parsedProjectId = Number(projectId);
  if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
    notFound();
  }

  let projectContext: Awaited<ReturnType<typeof resolveStrictUserAndProject>>;
  try {
    projectContext = await resolveStrictUserAndProject(parsedProjectId);
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") {
      notFound();
    }

    throw error;
  }

  const { project } = projectContext;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Project: {project.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {query.created === "1" && (
                <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 inline mr-2" />
                  Project created.
                </p>
              )}
              {query.renamed === "1" && (
                <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 inline mr-2" />
                  Project renamed.
                </p>
              )}

              <p className="text-sm text-muted-foreground">
                Choose what you want to do for this project.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Link
            href="/projects/chat"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Chat</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Ask questions using this project knowledge base.
            </p>
          </Link>

          <Link
            href="/projects/widget"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <WandSparkles className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Widget</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage embed token, domain allowlist, and deployment snippet.
            </p>
          </Link>

          <Link
            href="/projects/documents"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Upload className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Documents</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload and manage project documents for retrieval.
            </p>
          </Link>

          <Link
            href="/projects/actions"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Workflow className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Actions</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Configure chatbot actions and simple flow steps.
            </p>
          </Link>

          <Link
            href="/projects/operations"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <PlugZap className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Operations</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage backend tasks used by action flows.
            </p>
          </Link>

          <Link
            href="/projects/submissions"
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Submissions</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Review saved action submissions and status history.
            </p>
          </Link>

          <Link
            href={`/projects/${project.id}/settings`}
            className="rounded-lg border bg-white p-6 hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <Settings className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Settings</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Rename this project and manage project-level settings.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
