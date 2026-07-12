import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  LayoutTemplate,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getProjectAction } from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolveUserAndProject,
} from "@/lib/auth-project";
import {
  deleteProjectActionBuilderAction,
  updateProjectActionBuilderAction,
} from "../../actions";

type ActionSettingsPageProps = {
  params: Promise<{
    actionId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    updated?: string;
  }>;
};

function getExperimentSettings(settings: Record<string, unknown>) {
  const experiment = settings.experiment;

  if (
    !experiment ||
    typeof experiment !== "object" ||
    Array.isArray(experiment)
  ) {
    return {
      enabled: false,
      key: "",
      variantLabel: "",
      weight: 100,
    };
  }

  const record = experiment as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    key: typeof record.key === "string" ? record.key : "",
    variantLabel:
      typeof record.variantLabel === "string" ? record.variantLabel : "",
    weight:
      typeof record.weight === "number" && Number.isFinite(record.weight)
        ? record.weight
        : 100,
  };
}

function getTemplateSettings(settings: Record<string, unknown>) {
  const customTemplate = settings.customTemplate;

  if (
    !customTemplate ||
    typeof customTemplate !== "object" ||
    Array.isArray(customTemplate)
  ) {
    return {
      enabled: false,
      version: "1.0.0",
    };
  }

  const record = customTemplate as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    version:
      typeof record.version === "string" && record.version.trim()
        ? record.version
        : "1.0.0",
  };
}

export default async function ActionSettingsPage({
  params,
  searchParams,
}: ActionSettingsPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const actionId = Number(routeParams.actionId);

  if (!Number.isInteger(actionId) || actionId <= 0) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolveUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const experiment = getExperimentSettings(action.settings);
  const template = getTemplateSettings(action.settings);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          href={`/projects/actions/${action.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to action
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Action Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.updated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Action updated.
              </p>
            )}
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}

            <form
              action={updateProjectActionBuilderAction}
              className="space-y-4"
            >
              <input type="hidden" name="actionId" value={action.id} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Action Name</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={action.name}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    name="status"
                    defaultValue={action.status}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={action.description ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="triggerPhrases">Trigger Phrases</Label>
                <Textarea
                  id="triggerPhrases"
                  name="triggerPhrases"
                  defaultValue={action.triggerPhrases.join("\n")}
                />
              </div>

              <div className="rounded-md border bg-white p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <FlaskConical className="mt-0.5 h-5 w-5" />
                  <div className="space-y-1">
                    <p className="font-medium">Experiment Metadata</p>
                    <p className="text-sm text-muted-foreground">
                      Mark this flow as a variant now. Traffic allocation and
                      comparison reporting can use this metadata in the next
                      layer.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="experimentEnabled"
                    defaultChecked={experiment.enabled}
                    className="h-4 w-4 rounded border-input"
                  />
                  Include this action in an experiment
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="experimentKey">Experiment Key</Label>
                    <Input
                      id="experimentKey"
                      name="experimentKey"
                      defaultValue={experiment.key}
                      placeholder="e.g. booking-flow-test"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="experimentVariantLabel">
                      Variant Label
                    </Label>
                    <Input
                      id="experimentVariantLabel"
                      name="experimentVariantLabel"
                      defaultValue={experiment.variantLabel}
                      placeholder="e.g. Short form"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="experimentWeight">Traffic Weight</Label>
                    <Input
                      id="experimentWeight"
                      name="experimentWeight"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={experiment.weight}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border bg-white p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <LayoutTemplate className="mt-0.5 h-5 w-5" />
                  <div className="space-y-1">
                    <p className="font-medium">Project Template</p>
                    <p className="text-sm text-muted-foreground">
                      Make this flow available from the project template
                      catalog.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="templateEnabled"
                    defaultChecked={template.enabled}
                    className="h-4 w-4 rounded border-input"
                  />
                  Available as a project template
                </label>

                <div className="max-w-sm space-y-2">
                  <Label htmlFor="templateVersion">Template Version</Label>
                  <Input
                    id="templateVersion"
                    name="templateVersion"
                    defaultValue={template.version}
                    placeholder="1.0.0"
                  />
                </div>
              </div>

              <FormSubmitButton
                label="Save Action"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2 text-red-700">
              <Trash2 className="h-5 w-5" />
              Delete Action
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete this action, its flow steps, saved submissions, and
              submission events.
            </p>
            <form action={deleteProjectActionBuilderAction}>
              <input type="hidden" name="actionId" value={action.id} />
              <FormSubmitButton
                label="Delete Action"
                pendingLabel="Deleting..."
                variant="destructive"
                icon={<Trash2 className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
