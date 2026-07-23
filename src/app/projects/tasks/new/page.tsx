import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { ConversationalTaskDetailsFields } from "@/components/conversational-task-details-fields";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { createConversationalTaskAction } from "../actions";

type NewTaskPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function NewTaskPage({ searchParams }: NewTaskPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Tasks need a project" />;
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href="/projects/tasks"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tasks
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Plus className="h-6 w-6" />
              New Conversational Task
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start with the outcome Lia should help a visitor complete. You
              will add fields, tools, and completion rules in later steps.
            </p>
            {params.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {params.error}
              </p>
            )}

            <form action={createConversationalTaskAction} className="space-y-4">
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <ConversationalTaskDetailsFields />
              <FormSubmitButton
                label="Create Task"
                pendingLabel="Creating..."
                icon={<Plus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
