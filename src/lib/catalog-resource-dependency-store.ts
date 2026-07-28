import { and, eq } from "drizzle-orm";
import {
  type CatalogResourceTarget,
  containsCatalogReference,
  containsProductReference,
} from "@/lib/catalog-resource-dependencies";
import { db } from "@/lib/db-config";
import {
  actionFlowSteps,
  actionFlowVersions,
  conversationalTasks,
  conversationalTaskVersions,
  projectActions,
} from "@/lib/db-schema";

export type CatalogResourceDependency = {
  immutable: boolean;
  sourceId: number;
  sourceName: string;
  sourceType: "action_draft" | "action_version" | "task_draft" | "task_version";
};

function matchesTarget(value: unknown, target: CatalogResourceTarget) {
  return "catalogId" in target && target.catalogId !== undefined
    ? containsCatalogReference(value, target.catalogId)
    : "productId" in target && target.productId !== undefined
      ? containsProductReference(value, target.productId)
      : false;
}

async function listDependencies(
  projectId: number,
  target: CatalogResourceTarget,
) {
  const [actionDrafts, actionVersions, taskDrafts, taskVersions] =
    await Promise.all([
      db
        .select({
          id: actionFlowSteps.id,
          name: projectActions.name,
          options: actionFlowSteps.options,
          settings: actionFlowSteps.settings,
        })
        .from(actionFlowSteps)
        .innerJoin(
          projectActions,
          and(
            eq(projectActions.id, actionFlowSteps.actionId),
            eq(projectActions.projectId, projectId),
          ),
        )
        .where(eq(actionFlowSteps.projectId, projectId)),
      db
        .select({
          id: actionFlowVersions.id,
          name: projectActions.name,
          snapshot: actionFlowVersions.snapshot,
          versionNumber: actionFlowVersions.versionNumber,
        })
        .from(actionFlowVersions)
        .innerJoin(
          projectActions,
          and(
            eq(projectActions.id, actionFlowVersions.actionId),
            eq(projectActions.projectId, projectId),
          ),
        )
        .where(eq(actionFlowVersions.projectId, projectId)),
      db
        .select({
          definition: conversationalTasks.definition,
          id: conversationalTasks.id,
          name: conversationalTasks.name,
        })
        .from(conversationalTasks)
        .where(eq(conversationalTasks.projectId, projectId)),
      db
        .select({
          id: conversationalTaskVersions.id,
          name: conversationalTasks.name,
          snapshot: conversationalTaskVersions.snapshot,
          versionNumber: conversationalTaskVersions.versionNumber,
        })
        .from(conversationalTaskVersions)
        .innerJoin(
          conversationalTasks,
          and(
            eq(conversationalTasks.id, conversationalTaskVersions.taskId),
            eq(conversationalTasks.projectId, projectId),
          ),
        )
        .where(eq(conversationalTaskVersions.projectId, projectId)),
    ]);

  const dependencies: CatalogResourceDependency[] = [];

  for (const draft of actionDrafts) {
    if (
      matchesTarget(draft.options, target) ||
      matchesTarget(draft.settings, target)
    ) {
      dependencies.push({
        immutable: false,
        sourceId: draft.id,
        sourceName: draft.name,
        sourceType: "action_draft",
      });
    }
  }

  for (const version of actionVersions) {
    if (matchesTarget(version.snapshot, target)) {
      dependencies.push({
        immutable: true,
        sourceId: version.id,
        sourceName: `${version.name} v${version.versionNumber}`,
        sourceType: "action_version",
      });
    }
  }

  for (const draft of taskDrafts) {
    if (matchesTarget(draft.definition, target)) {
      dependencies.push({
        immutable: false,
        sourceId: draft.id,
        sourceName: draft.name,
        sourceType: "task_draft",
      });
    }
  }

  for (const version of taskVersions) {
    if (matchesTarget(version.snapshot, target)) {
      dependencies.push({
        immutable: true,
        sourceId: version.id,
        sourceName: `${version.name} v${version.versionNumber}`,
        sourceType: "task_version",
      });
    }
  }

  return dependencies;
}

export function listCatalogDependencies(projectId: number, catalogId: number) {
  return listDependencies(projectId, { catalogId });
}

export function listProductDependencies(projectId: number, productId: number) {
  return listDependencies(projectId, { productId });
}
