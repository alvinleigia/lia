import type { ActionFlowResourceKind } from "@/lib/action-flow-export";
import { listActiveProjectActions } from "@/lib/action-flows";
import { listPublishedConversationalTaskOptions } from "@/lib/conversational-tasks";
import { listProjectMediaAssets } from "@/lib/media-assets";
import { listProjectOperations } from "@/lib/operations";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "@/lib/product-catalogs";

export async function loadActionFlowCloneResources(projectId: number) {
  const [
    catalogs,
    catalogProducts,
    connectedActions,
    conversationalTaskVersions,
    mediaAssets,
    operations,
  ] = await Promise.all([
    listProjectCatalogs(projectId),
    listProjectCatalogProducts(projectId),
    listActiveProjectActions(projectId),
    listPublishedConversationalTaskOptions(projectId),
    listProjectMediaAssets(projectId),
    listProjectOperations(projectId),
  ]);

  return {
    catalogs,
    catalogProducts,
    connectedActions,
    conversationalTaskVersions,
    mediaAssets,
    operations,
  };
}

export type ActionFlowCloneResources = Awaited<
  ReturnType<typeof loadActionFlowCloneResources>
>;

export const ACTION_FLOW_CLONE_DISCONNECTED_VALUE = "__disconnected__";

export function getActionFlowCloneResourceFieldName(
  kind: ActionFlowResourceKind,
  sourceId: number,
) {
  return `resource:${kind}:${sourceId}`;
}

export function getActionFlowCloneResourceChoices(
  kind: ActionFlowResourceKind,
  resources: ActionFlowCloneResources,
) {
  switch (kind) {
    case "catalog":
      return resources.catalogs.map((catalog) => ({
        id: catalog.id,
        label: catalog.name,
      }));
    case "catalog_product":
      return resources.catalogProducts.map(({ catalog, product }) => ({
        id: product.id,
        label: `${catalog.name} - ${product.name}`,
      }));
    case "connected_action":
      return resources.connectedActions.map((action) => ({
        id: action.id,
        label: action.name,
      }));
    case "conversational_task_version":
      return resources.conversationalTaskVersions.map((task) => ({
        id: task.taskVersionId,
        label: `${task.name} v${task.versionNumber}`,
      }));
    case "media_asset":
      return resources.mediaAssets.map((asset) => ({
        id: asset.id,
        label: asset.originalName,
      }));
    case "operation":
      return resources.operations.map(({ operation }) => ({
        id: operation.id,
        label: `${operation.name} (${operation.operationType})`,
      }));
  }
}

export function hasActionFlowCloneResource(
  kind: ActionFlowResourceKind,
  resourceId: number,
  resources: ActionFlowCloneResources,
) {
  return getActionFlowCloneResourceChoices(kind, resources).some(
    (choice) => choice.id === resourceId,
  );
}
