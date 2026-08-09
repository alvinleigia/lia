import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FlaskConical,
  LayoutTemplate,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlashToast } from "@/components/ui/flash-toast";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getActionAvailabilitySettings } from "@/lib/action-availability";
import { getProjectAction } from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import { getStructuredFormSettings } from "@/lib/structured-forms";
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
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const experiment = getExperimentSettings(action.settings);
  const template = getTemplateSettings(action.settings);
  const availability = getActionAvailabilitySettings(action.settings);
  const structuredForm = getStructuredFormSettings(action.settings);
  const whatsAppForm = structuredForm.providers.whatsapp;

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
              <FlashToast
                clearParams="updated"
                id="action-updated"
                message="Action updated."
              />
            )}
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}

            <ActionStateForm
              action={updateProjectActionBuilderAction}
              className="space-y-4"
            >
              <ActionFormError />
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
                  <CalendarClock className="mt-0.5 h-5 w-5" />
                  <div className="space-y-1">
                    <p className="font-medium">Runtime Availability</p>
                    <p className="text-sm text-muted-foreground">
                      Expose deterministic business-hours and handoff-queue
                      values to branch rules without relying on model output.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="businessHoursEnabled"
                    defaultChecked={availability.businessHours.enabled}
                    className="h-4 w-4 rounded border-input"
                  />
                  Evaluate business hours at runtime
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="businessHoursTimeZone">Time Zone</Label>
                    <Input
                      id="businessHoursTimeZone"
                      name="businessHoursTimeZone"
                      defaultValue={availability.businessHours.timeZone}
                      placeholder="Asia/Kolkata"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessHoursWeekdays">Business Days</Label>
                    <Input
                      id="businessHoursWeekdays"
                      name="businessHoursWeekdays"
                      defaultValue={availability.businessHours.weekdays.join(
                        ", ",
                      )}
                      placeholder="1, 2, 3, 4, 5"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use 0 for Sunday through 6 for Saturday.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessHoursStartTime">Opens At</Label>
                    <Input
                      id="businessHoursStartTime"
                      name="businessHoursStartTime"
                      type="time"
                      defaultValue={availability.businessHours.startTime}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessHoursEndTime">Closes At</Label>
                    <Input
                      id="businessHoursEndTime"
                      name="businessHoursEndTime"
                      type="time"
                      defaultValue={availability.businessHours.endTime}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name="queueAvailabilityEnabled"
                      defaultChecked={availability.queue.enabled}
                      className="h-4 w-4 rounded border-input"
                    />
                    Expose handoff queue availability
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name="queueAvailable"
                      defaultChecked={availability.queue.available}
                      className="h-4 w-4 rounded border-input"
                    />
                    Queue currently available
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Use Business hours open or Handoff queue available as a branch
                  field on the canvas, with comparison value true or false.
                </p>
              </div>

              <div className="rounded-md border bg-white p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <ClipboardList className="mt-0.5 h-5 w-5" />
                  <div className="space-y-1">
                    <p className="font-medium">Structured Form</p>
                    <p className="text-sm text-muted-foreground">
                      Govern one versioned set of task fields. Browser channels
                      use the existing guided collection flow; optional WhatsApp
                      Flow JSON remains at the provider boundary.
                    </p>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="structuredFormEnabled"
                    defaultChecked={structuredForm.enabled}
                    className="h-4 w-4 rounded border-input"
                  />
                  Enable structured form governance
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="structuredFormKey">Form Key</Label>
                    <Input
                      id="structuredFormKey"
                      name="structuredFormKey"
                      defaultValue={structuredForm.key}
                      placeholder="booking_details"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="structuredFormVersion">Version</Label>
                    <Input
                      id="structuredFormVersion"
                      name="structuredFormVersion"
                      defaultValue={structuredForm.version}
                      placeholder="1.0.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="structuredFormStatus">Status</Label>
                    <select
                      id="structuredFormStatus"
                      name="structuredFormStatus"
                      defaultValue={structuredForm.status}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="structuredFormFieldKeys">
                    Task Field Keys
                  </Label>
                  <Textarea
                    id="structuredFormFieldKeys"
                    name="structuredFormFieldKeys"
                    defaultValue={structuredForm.fieldKeys.join("\n")}
                    placeholder={"guestName\nguestEmail\npreferredDate"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter one exact enabled collection-step field key per line.
                  </p>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <div>
                    <p className="font-medium">Optional WhatsApp Adapter</p>
                    <p className="text-sm text-muted-foreground">
                      Leave both fields blank to use guided conversational
                      fallback. Provider JSON must not contain credentials.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="structuredFormWhatsAppSchemaVersion">
                      WhatsApp Schema Version
                    </Label>
                    <Input
                      id="structuredFormWhatsAppSchemaVersion"
                      name="structuredFormWhatsAppSchemaVersion"
                      defaultValue={whatsAppForm?.schemaVersion ?? ""}
                      placeholder="7.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="structuredFormWhatsAppFlow">
                      WhatsApp Flow JSON
                    </Label>
                    <Textarea
                      id="structuredFormWhatsAppFlow"
                      name="structuredFormWhatsAppFlow"
                      className="min-h-40 font-mono text-xs"
                      defaultValue={
                        whatsAppForm
                          ? JSON.stringify(whatsAppForm.flow, null, 2)
                          : ""
                      }
                      placeholder={'{\n  "screens": []\n}'}
                    />
                  </div>
                </div>
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
            </ActionStateForm>
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
