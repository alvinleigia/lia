import { ArrowLeft, Copy, FolderGit2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  ACTION_FLOW_CLONE_DISCONNECTED_VALUE,
  getActionFlowCloneResourceChoices,
  getActionFlowCloneResourceFieldName,
  loadActionFlowCloneResources,
} from "@/lib/action-flow-clone-resources";
import {
  type ActionFlowResourceKind,
  buildProjectActionFlowExport,
  collectActionFlowResourceReferences,
} from "@/lib/action-flow-export";
import { getProjectAction } from "@/lib/action-flows";
import { listActiveProjectsForWorkspace } from "@/lib/projects";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import { cloneActionFlowAction } from "./actions";

type CloneActionFlowPageProps = {
  params: Promise<{ actionId: string }>;
  searchParams: Promise<{ targetProjectId?: string }>;
};

const RESOURCE_KIND_LABELS: Record<ActionFlowResourceKind, string> = {
  catalog: "Catalog",
  catalog_product: "Catalog product",
  connected_action: "Connected action",
  conversational_task_version: "Published conversational task",
  media_asset: "Media asset",
  operation: "Operation",
};

export default async function CloneActionFlowPage({
  params,
  searchParams,
}: CloneActionFlowPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const actionId = Number(routeParams.actionId);
  if (!Number.isInteger(actionId) || actionId <= 0) notFound();

  const activeProjectId = await getActiveProjectIdCookie();
  const { project, workspace } =
    await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);
  if (!action) notFound();

  const projects = (await listActiveProjectsForWorkspace(workspace.id)).filter(
    (candidate) => candidate.id !== project.id,
  );
  const requestedTargetProjectId = Number(query.targetProjectId);
  const targetProject = projects.find(
    (candidate) => candidate.id === requestedTargetProjectId,
  );

  const exportData = targetProject
    ? await buildProjectActionFlowExport({ actionId: action.id, project })
    : null;
  const references = exportData
    ? collectActionFlowResourceReferences(exportData)
    : [];
  const resources = targetProject
    ? await loadActionFlowCloneResources(targetProject.id)
    : null;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href={`/projects/actions/${action.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to action
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Copy className="h-6 w-6" />
              Clone {action.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Create an editable draft in another project and explicitly map
              every project-owned resource used by this flow.
            </p>

            {projects.length === 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Create another active project in this workspace before cloning
                this action.
              </p>
            ) : (
              <form
                method="get"
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <div className="flex-1 space-y-2">
                  <Label htmlFor="targetProjectId">Target project</Label>
                  <select
                    id="targetProjectId"
                    name="targetProjectId"
                    defaultValue={targetProject?.id ?? ""}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="" disabled>
                      Choose a project
                    </option>
                    {projects.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="outline">
                  <FolderGit2 className="h-4 w-4" />
                  Review mappings
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {targetProject && exportData && resources && (
          <Card>
            <CardHeader>
              <CardTitle>Clone into {targetProject.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionStateForm
                action={cloneActionFlowAction}
                className="space-y-6"
              >
                <ActionFormError />
                <input type="hidden" name="sourceActionId" value={action.id} />
                <input
                  type="hidden"
                  name="sourceProjectId"
                  value={project.id}
                />
                <input
                  type="hidden"
                  name="targetProjectId"
                  value={targetProject.id}
                />

                <div className="space-y-2">
                  <Label htmlFor="name">Cloned action name</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={`${action.name} (Clone)`}
                    maxLength={160}
                    required
                  />
                </div>

                {references.length > 0 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-semibold">Resource mappings</h2>
                      <p className="text-sm text-muted-foreground">
                        Select the matching resource in {targetProject.name}, or
                        leave it disconnected and repair the draft later.
                      </p>
                    </div>
                    {references.map((reference) => {
                      const fieldName = getActionFlowCloneResourceFieldName(
                        reference.kind,
                        reference.sourceId,
                      );
                      const choices = getActionFlowCloneResourceChoices(
                        reference.kind,
                        resources,
                      );

                      return (
                        <div
                          key={`${reference.kind}:${reference.sourceId}`}
                          className="space-y-2 rounded-lg border p-4"
                        >
                          <Label htmlFor={fieldName}>
                            {RESOURCE_KIND_LABELS[reference.kind]} from{" "}
                            {reference.stepLabel}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Source resource ID: {reference.sourceId}
                          </p>
                          <select
                            id={fieldName}
                            name={fieldName}
                            defaultValue={ACTION_FLOW_CLONE_DISCONNECTED_VALUE}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option
                              value={ACTION_FLOW_CLONE_DISCONNECTED_VALUE}
                            >
                              Leave disconnected
                            </option>
                            {choices.map((choice) => (
                              <option key={choice.id} value={choice.id}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}

                <FormSubmitButton
                  label="Clone action"
                  pendingLabel="Cloning..."
                  icon={<Copy className="h-4 w-4" />}
                />
              </ActionStateForm>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
