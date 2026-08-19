import { CheckCircle2, Copy, Database, Plus, RefreshCw } from "lucide-react";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkReusableTemplateCompatibility,
  getReusableTemplateUpgradeGuidance,
  type listReusableFields,
  type listReusableTemplates,
  REUSABLE_FIELD_TYPES,
  REUSABLE_TEMPLATE_KINDS,
} from "@/lib/reuse-registry";
import {
  addReusableTemplateVersionAction,
  approveReusableTemplateAction,
  createReusableFieldAction,
  createReusableTemplateAction,
  duplicateReusableTemplateAction,
  retireReusableFieldAction,
} from "./actions";

type RegistrySectionsProps = {
  fields: Awaited<ReturnType<typeof listReusableFields>>;
  projectId: number;
  templates: Awaited<ReturnType<typeof listReusableTemplates>>;
};

const fieldSetExample = JSON.stringify(
  {
    fields: [
      {
        key: "customer_email",
        label: "Customer email",
        required: true,
        type: "email",
      },
    ],
  },
  null,
  2,
);

function formatValue(value: string) {
  return value.replaceAll("_", " ");
}

export function ReuseRegistrySections({
  fields,
  projectId,
  templates,
}: RegistrySectionsProps) {
  const activeFields = fields.filter((field) => field.status === "active");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Database className="h-6 w-6" />
            Reusable Fields
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Register typed fields once, then reuse the same contract in task and
            canvas steps.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <ActionStateForm
            action={createReusableFieldAction}
            className="grid gap-3 rounded-md border bg-white p-4 md:grid-cols-2"
          >
            <ActionFormError className="md:col-span-2" />
            <div className="space-y-2">
              <Label htmlFor="registry-field-key">Field key</Label>
              <Input
                id="registry-field-key"
                name="key"
                placeholder="customer_email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-field-label">Label</Label>
              <Input
                id="registry-field-label"
                name="label"
                placeholder="Customer email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-field-type">Type</Label>
              <select
                id="registry-field-type"
                name="fieldType"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {REUSABLE_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatValue(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-field-scope">Ownership</Label>
              <select
                id="registry-field-scope"
                name="scope"
                defaultValue="project"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="project">This project</option>
                <option value="company">Entire company</option>
              </select>
            </div>
            <FormSubmitButton
              className="md:col-span-2 md:w-fit"
              label="Register Field"
              pendingLabel="Registering..."
              icon={<Plus className="h-4 w-4" />}
            />
          </ActionStateForm>

          <div className="grid gap-3 md:grid-cols-2">
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground md:col-span-2">
                No reusable fields registered yet.
              </p>
            ) : (
              fields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-start justify-between gap-3 rounded-md border bg-white p-4"
                >
                  <div>
                    <p className="font-medium">{field.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {field.key} / {formatValue(field.fieldType)} /{" "}
                      {field.projectId === null ? "company" : "project"}
                    </p>
                    <span className="mt-2 inline-flex rounded-md border px-2 py-1 text-xs capitalize">
                      {field.status}
                    </span>
                  </div>
                  {field.status === "active" && (
                    <form action={retireReusableFieldAction}>
                      <input type="hidden" name="fieldId" value={field.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Retire
                      </Button>
                    </form>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <RefreshCw className="h-6 w-6" />
            Reusable Content
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Version, approve, duplicate, and assess compatibility for tasks,
            field sets, nodes, and composed content.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <ActionStateForm
            action={createReusableTemplateAction}
            className="space-y-3 rounded-md border bg-white p-4"
          >
            <ActionFormError />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="registry-template-name">Name</Label>
                <Input
                  id="registry-template-name"
                  name="name"
                  placeholder="Customer contact fields"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registry-template-key">Template key</Label>
                <Input
                  id="registry-template-key"
                  name="key"
                  placeholder="customer_contact_fields"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registry-template-kind">Kind</Label>
                <select
                  id="registry-template-kind"
                  name="kind"
                  defaultValue="field_set"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {REUSABLE_TEMPLATE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {formatValue(kind)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="registry-template-scope">Ownership</Label>
                <select
                  id="registry-template-scope"
                  name="scope"
                  defaultValue="project"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="project">This project</option>
                  <option value="company">Entire company</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-template-description">Description</Label>
              <Input
                id="registry-template-description"
                name="description"
                placeholder="Fields shared by support and booking flows"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-template-payload">JSON definition</Label>
              <textarea
                id="registry-template-payload"
                name="payload"
                defaultValue={fieldSetExample}
                required
                className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              />
            </div>
            <FormSubmitButton
              label="Create Reusable Template"
              pendingLabel="Creating..."
              icon={<Plus className="h-4 w-4" />}
            />
          </ActionStateForm>

          <div className="space-y-4">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No reusable content templates created yet.
              </p>
            ) : (
              templates.map((template) => {
                const current = template.versions.find(
                  (version) =>
                    version.versionNumber === template.currentVersion,
                );
                const previous = template.versions.find(
                  (version) =>
                    version.versionNumber === template.currentVersion - 1,
                );
                const compatibility = current
                  ? checkReusableTemplateCompatibility(
                      current.payload,
                      activeFields,
                    )
                  : {
                      compatible: false,
                      errors: ["Current version is missing."],
                    };
                const guidance =
                  current && previous
                    ? getReusableTemplateUpgradeGuidance(
                        previous.payload,
                        current.payload,
                      )
                    : null;

                return (
                  <div
                    key={template.id}
                    className="space-y-4 rounded-md border bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatValue(template.kind)} / {template.key} / v
                          {template.currentVersion} /{" "}
                          {template.projectId === null ? "company" : "project"}
                        </p>
                        {template.description && (
                          <p className="mt-1 text-sm">{template.description}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-md border px-2 py-1 text-xs capitalize">
                          {template.status}
                        </span>
                        {compatibility.compatible ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Compatible
                          </span>
                        ) : (
                          <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                            Needs mapping
                          </span>
                        )}
                      </div>
                    </div>

                    {!compatibility.compatible && (
                      <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {compatibility.errors.map((error) => (
                          <p key={error}>{error}</p>
                        ))}
                      </div>
                    )}
                    {guidance && (
                      <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                        {guidance.guidance}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {template.status !== "approved" &&
                        compatibility.compatible && (
                          <form action={approveReusableTemplateAction}>
                            <input
                              type="hidden"
                              name="templateId"
                              value={template.id}
                            />
                            <Button type="submit" size="sm">
                              Approve Current Version
                            </Button>
                          </form>
                        )}
                      <form action={duplicateReusableTemplateAction}>
                        <input
                          type="hidden"
                          name="templateId"
                          value={template.id}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          <Copy className="h-4 w-4" />
                          Duplicate Into Project
                        </Button>
                      </form>
                    </div>

                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Add a new version
                      </summary>
                      <ActionStateForm
                        action={addReusableTemplateVersionAction}
                        className="mt-3 space-y-3"
                      >
                        <ActionFormError />
                        <input
                          type="hidden"
                          name="templateId"
                          value={template.id}
                        />
                        <textarea
                          name="payload"
                          defaultValue={JSON.stringify(
                            current?.payload ?? {},
                            null,
                            2,
                          )}
                          required
                          className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                        />
                        <FormSubmitButton
                          label="Save New Version"
                          pendingLabel="Saving..."
                        />
                      </ActionStateForm>
                    </details>

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {template.versions.map((version) => (
                        <span
                          key={version.id}
                          className="rounded-md border px-2 py-1"
                        >
                          v{version.versionNumber}
                          {version.approvedAt ? " / approved" : ""}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Project #{projectId}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
