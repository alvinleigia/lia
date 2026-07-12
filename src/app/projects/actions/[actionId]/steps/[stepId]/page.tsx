import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionBranchRulesForm } from "@/components/action-branch-rules-form";
import { ActionStepForm } from "@/components/action-step-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getActionFlowStep,
  getProjectAction,
  listActionFlowBranchRulesForStep,
  listActionFlowSteps,
  listActiveProjectActions,
  listProjectReusableActionFields,
} from "@/lib/action-flows";
import { listProjectMediaAssets } from "@/lib/media-assets";
import { listProjectOperations } from "@/lib/operations";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "@/lib/product-catalogs";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";

type EditActionStepPageProps = {
  params: Promise<{
    actionId: string;
    stepId: string;
  }>;
  searchParams: Promise<{
    branchCreated?: string;
    branchDeleted?: string;
    branchUpdated?: string;
    error?: string;
  }>;
};

function getOperationRoutePresetTargetId(
  rules: Awaited<ReturnType<typeof listActionFlowBranchRulesForStep>>,
  preset: "failure" | "success",
) {
  return (
    rules.find((rule) => rule.settings.operationRoutePreset === preset)
      ?.targetStepId ?? null
  );
}

export default async function EditActionStepPage({
  params,
  searchParams,
}: EditActionStepPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const actionId = Number(routeParams.actionId);
  const stepId = Number(routeParams.stepId);

  if (
    !Number.isInteger(actionId) ||
    actionId <= 0 ||
    !Number.isInteger(stepId) ||
    stepId <= 0
  ) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const step = await getActionFlowStep(project.id, action.id, stepId);

  if (!step) {
    notFound();
  }

  const steps = await listActionFlowSteps(project.id, action.id);
  const branchRules = await listActionFlowBranchRulesForStep(
    project.id,
    action.id,
    step.id,
  );
  const nextBranchSortOrder =
    branchRules.reduce((max, rule) => Math.max(max, rule.sortOrder), 0) + 1;
  const [
    operationRows,
    mediaAssetRows,
    productCatalogRows,
    productRows,
    actionRows,
    reusableFields,
  ] = await Promise.all([
    listProjectOperations(project.id),
    listProjectMediaAssets(project.id),
    listProjectCatalogs(project.id),
    listProjectCatalogProducts(project.id),
    listActiveProjectActions(project.id),
    listProjectReusableActionFields(project.id),
  ]);
  const operations = operationRows.map((row) => ({
    id: row.operation.id,
    name: `${row.operation.name} (${row.provider.providerType})`,
  }));
  const mediaAssets = mediaAssetRows.map((asset) => ({
    id: asset.id,
    label: asset.originalName,
    mediaType: asset.mediaType,
  }));
  const productCatalogs = productCatalogRows.map((catalog) => ({
    id: catalog.id,
    name: catalog.name,
  }));
  const catalogProducts = productRows.map(({ catalog, product }) => ({
    catalogId: catalog.id,
    catalogName: catalog.name,
    id: product.id,
    name: product.name,
    sku: product.sku,
  }));
  const projectActions = actionRows
    .filter((projectAction) => projectAction.id !== action.id)
    .map((projectAction) => ({
      id: projectAction.id,
      name: projectAction.name,
    }));

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
              Edit Flow Step
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(query.branchCreated ||
              query.branchUpdated ||
              query.branchDeleted) && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Branch rule changes saved.
              </p>
            )}
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}
            <ActionStepForm
              actionId={action.id}
              catalogProducts={catalogProducts}
              mediaAssets={mediaAssets}
              mode="edit"
              step={step}
              operations={operations}
              productCatalogs={productCatalogs}
              projectActions={projectActions}
              reusableFields={reusableFields}
              operationRoutePresets={{
                failureStepId: getOperationRoutePresetTargetId(
                  branchRules,
                  "failure",
                ),
                successStepId: getOperationRoutePresetTargetId(
                  branchRules,
                  "success",
                ),
              }}
              routeStepOptions={steps}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Branch Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionBranchRulesForm
              actionId={action.id}
              defaultSourceFieldKey={step.fieldKey ?? ""}
              nextSortOrder={nextBranchSortOrder}
              rules={branchRules}
              sourceStepId={step.id}
              steps={steps}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
