import { ArrowLeft, Settings, Workflow } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionFlowCanvas } from "@/components/action-flow-canvas";
import { Button } from "@/components/ui/button";
import {
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  listActiveProjectActions,
  validateActionFlowRoutes,
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

type ActionCanvasPageProps = {
  params: Promise<{
    actionId: string;
  }>;
};

export default async function ActionCanvasPage({
  params,
}: ActionCanvasPageProps) {
  const routeParams = await params;
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

  const [
    steps,
    branchRules,
    routeIssues,
    operationRows,
    mediaAssetRows,
    productCatalogRows,
    productRows,
    actionRows,
  ] = await Promise.all([
    listActionFlowSteps(project.id, action.id),
    listActionFlowBranchRules(project.id, action.id),
    validateActionFlowRoutes(project.id, action.id),
    listProjectOperations(project.id),
    listProjectMediaAssets(project.id),
    listProjectCatalogs(project.id),
    listProjectCatalogProducts(project.id),
    listActiveProjectActions(project.id),
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
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <Link
          href={`/projects/actions/${action.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to action
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Workflow className="h-6 w-6" />
              {action.name} Canvas
            </h1>
            <p className="text-sm text-muted-foreground">
              Visual flow builder for steps, routing, and validation.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/projects/actions/${action.id}/settings`}>
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>

        <ActionFlowCanvas
          actionId={action.id}
          branchRules={branchRules}
          catalogProducts={catalogProducts}
          mediaAssets={mediaAssets}
          operations={operations}
          productCatalogs={productCatalogs}
          projectActions={projectActions}
          routeIssues={routeIssues}
          steps={steps}
        />
      </div>
    </div>
  );
}
