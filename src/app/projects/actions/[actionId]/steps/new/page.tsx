import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionStepForm } from "@/components/action-step-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getProjectAction,
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

type NewActionStepPageProps = {
  params: Promise<{
    actionId: string;
  }>;
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function NewActionStepPage({
  params,
  searchParams,
}: NewActionStepPageProps) {
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

  const steps = await listActionFlowSteps(project.id, action.id);
  const nextSortOrder =
    steps.reduce((max, step) => Math.max(max, step.sortOrder), 0) + 1;
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
              <Plus className="h-6 w-6" />
              New Flow Step
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}
            <ActionStepForm
              actionId={action.id}
              catalogProducts={catalogProducts}
              mediaAssets={mediaAssets}
              mode="create"
              nextSortOrder={nextSortOrder}
              operations={operations}
              productCatalogs={productCatalogs}
              projectActions={projectActions}
              reusableFields={reusableFields}
              routeStepOptions={steps}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
