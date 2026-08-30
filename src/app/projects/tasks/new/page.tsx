import { ArrowLeft, Check, Plus } from "lucide-react";
import Link from "next/link";
import { ConversationalTaskDetailsFields } from "@/components/conversational-task-details-fields";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  CONVERSATIONAL_TASK_TEMPLATE_KEYS,
  CONVERSATIONAL_TASK_TEMPLATES,
  getConversationalTaskTemplate,
} from "@/lib/conversational-task-templates";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { createConversationalTaskAction } from "../actions";

type NewTaskPageProps = {
  searchParams: Promise<{
    error?: string;
    template?: string;
  }>;
};

export default async function NewTaskPage({ searchParams }: NewTaskPageProps) {
  const params = await searchParams;
  const selectedTemplateKey =
    CONVERSATIONAL_TASK_TEMPLATE_KEYS.find((key) => key === params.template) ??
    "booking";
  const selectedTemplate = getConversationalTaskTemplate(selectedTemplateKey);
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

        <section className="space-y-3" aria-labelledby="task-template-heading">
          <div>
            <h1 id="task-template-heading" className="text-xl font-semibold">
              Choose a starting point
            </h1>
            <p className="text-sm text-muted-foreground">
              Every template uses the same channel-independent task contract.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {CONVERSATIONAL_TASK_TEMPLATES.map((template) => {
              const selected = template.key === selectedTemplateKey;
              return (
                <Link
                  key={template.key}
                  href={`/projects/tasks/new?template=${template.key}`}
                  className={`rounded-md border bg-white p-4 transition-colors hover:bg-gray-50 ${
                    selected ? "border-gray-900 ring-1 ring-gray-900" : ""
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-medium">{template.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {template.description}
                      </span>
                    </span>
                    {selected && <Check className="h-5 w-5 shrink-0" />}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Plus className="h-6 w-6" />
              New Conversational Task
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Give this task a clear business goal. You can adjust its fields,
              tools, and outcomes after creation.
            </p>
            {params.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {params.error}
              </p>
            )}

            <ActionStateForm
              action={createConversationalTaskAction}
              className="space-y-4"
              key={selectedTemplateKey}
            >
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input
                type="hidden"
                name="templateKey"
                value={selectedTemplateKey}
              />
              <ConversationalTaskDetailsFields
                defaultValues={{
                  name: selectedTemplate?.defaultName,
                  objective: selectedTemplate?.defaultObjective,
                }}
              />
              <div className="space-y-2">
                <label
                  htmlFor="completionAction"
                  className="text-sm font-medium"
                >
                  After completion
                </label>
                <select
                  id="completionAction"
                  name="completionAction"
                  defaultValue="return_to_knowledge"
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="return_to_knowledge">
                    Continue helping the visitor
                  </option>
                  <option value="end">End the conversation</option>
                </select>
              </div>
              <FormSubmitButton
                label="Create Task"
                pendingLabel="Creating..."
                icon={<Plus className="h-4 w-4" />}
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
