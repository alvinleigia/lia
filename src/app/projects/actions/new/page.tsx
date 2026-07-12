import { ArrowLeft, Bot, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listActionTemplates } from "@/lib/action-templates";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import {
  applyActionTemplateAction,
  createProjectActionBuilderAction,
} from "../actions";

type NewActionPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function NewActionPage({
  searchParams,
}: NewActionPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const templates = listActionTemplates();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          href="/projects/actions"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to actions
        </Link>

        {params.error && (
          <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
            {params.error}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Workflow className="h-6 w-6" />
              New Action: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start from a reusable business flow and adjust it after creation.
            </p>
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.key}
                  className="rounded-md border bg-white p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{template.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {template.description}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-md border bg-slate-50 px-2 py-1 text-slate-700">
                          v{template.summary.version}
                        </span>
                        <span className="rounded-md border bg-slate-50 px-2 py-1 text-slate-700">
                          {template.summary.stepCount} steps
                        </span>
                        <span className="rounded-md border bg-slate-50 px-2 py-1 text-slate-700">
                          {template.businessTypes.join(", ")}
                        </span>
                      </div>
                    </div>
                    <form action={applyActionTemplateAction}>
                      <input
                        type="hidden"
                        name="templateKey"
                        value={template.key}
                      />
                      <input
                        type="hidden"
                        name="sourcePath"
                        value="/projects/actions/new"
                      />
                      <FormSubmitButton
                        label="Apply Template"
                        pendingLabel="Applying..."
                        icon={<Plus className="h-4 w-4" />}
                      />
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Blank Action
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createProjectActionBuilderAction}
              className="space-y-4"
            >
              <input type="hidden" name="projectId" value={project.id} />

              <div className="space-y-2">
                <Label htmlFor="name">Action Name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Book Spa Service"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="What this action helps the user complete"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="triggerPhrases">Trigger Phrases</Label>
                <Textarea
                  id="triggerPhrases"
                  name="triggerPhrases"
                  placeholder={"book spa\nschedule massage\nspa appointment"}
                />
              </div>

              <input type="hidden" name="status" value="draft" />

              <FormSubmitButton
                label="Create Action"
                pendingLabel="Creating..."
                icon={<Bot className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
