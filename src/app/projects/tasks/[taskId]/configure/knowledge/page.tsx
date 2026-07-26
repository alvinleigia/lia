import { ArrowLeft, BookOpen, Save } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActionBar } from "@/components/ui/form-action-bar";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { getProjectConversationalTask } from "@/lib/conversational-tasks";
import { getProjectDocumentStats } from "@/lib/documents";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { updateConversationKnowledgePolicyAction } from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm";

export default async function TaskKnowledgePage({
  params,
  searchParams,
}: PageProps) {
  const route = conversationalTaskIdSchema.safeParse((await params).taskId);
  const query = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!route.success || !context) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const [task, policy, documentStats] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    getConversationProjectPolicy(context.project.id),
    getProjectDocumentStats(context.project.id),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          href={`/projects/tasks/${task.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to task
        </Link>
        <TaskConfigurationNav active="knowledge" taskId={task.id} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <BookOpen className="h-6 w-6" />
              Knowledge
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose how Lia uses this project&apos;s approved information
              alongside the task.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {query.saved && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Knowledge settings saved.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">Documents</p>
                <p className="mt-1 text-2xl font-semibold">
                  {documentStats.totalDocuments}
                </p>
              </div>
              <div className="rounded-md border p-4">
                <p className="text-sm text-muted-foreground">
                  Indexed sections
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {documentStats.totalChunks}
                </p>
              </div>
            </div>

            <ActionStateForm
              action={updateConversationKnowledgePolicyAction}
              className="space-y-5"
            >
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="space-y-2">
                <Label htmlFor="noAnswerBehavior">
                  When the answer is not available
                </Label>
                <select
                  id="noAnswerBehavior"
                  name="noAnswerBehavior"
                  defaultValue={policy.knowledge.noAnswerBehavior}
                  className={selectClass}
                >
                  <option value="fallback">Use the project fallback</option>
                  <option value="handoff">Offer team help</option>
                  <option value="task_recommendation">
                    Recommend a relevant task
                  </option>
                </select>
              </div>
              <label className="flex items-start gap-3 rounded-md border p-4">
                <input
                  type="checkbox"
                  name="allowTaskRecommendation"
                  defaultChecked={policy.entry.allowTaskRecommendation}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Recommend published tasks
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Lia may suggest a matching task, but the server still
                    validates the selection before starting it.
                  </span>
                </span>
              </label>
              <FormActionBar
                primaryAction={
                  <FormSubmitButton
                    label="Save Knowledge Settings"
                    pendingLabel="Saving..."
                    icon={<Save className="h-4 w-4" />}
                  />
                }
                secondaryActions={
                  <Button asChild variant="outline">
                    <Link href="/projects/documents">Manage Documents</Link>
                  </Button>
                }
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
