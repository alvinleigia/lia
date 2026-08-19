"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import {
  ACTION_FLOW_CLONE_DISCONNECTED_VALUE,
  getActionFlowCloneResourceFieldName,
  hasActionFlowCloneResource,
  loadActionFlowCloneResources,
} from "@/lib/action-flow-clone-resources";
import {
  type ActionFlowResourceMappings,
  buildProjectActionFlowExport,
  collectActionFlowResourceReferences,
  importActionFlowExport,
} from "@/lib/action-flow-export";
import { getProjectAction } from "@/lib/action-flows";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import {
  resolveStrictUserAndProject,
  setActiveProjectCookie,
} from "@/lib/auth-project";

const cloneActionFlowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sourceActionId: z.coerce.number().int().positive(),
  sourceProjectId: z.coerce.number().int().positive(),
  targetProjectId: z.coerce.number().int().positive(),
});

export async function cloneActionFlowAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = cloneActionFlowSchema.safeParse({
    name: formData.get("name"),
    sourceActionId: formData.get("sourceActionId"),
    sourceProjectId: formData.get("sourceProjectId"),
    targetProjectId: formData.get("targetProjectId"),
  });

  if (!parsed.success) {
    return { error: "Check the clone name and selected projects." };
  }

  const sourceContext = await resolveStrictUserAndProject(
    parsed.data.sourceProjectId,
  );
  assertPermission(sourceContext.membership, "company.project.manage");
  const targetContext = await resolveStrictUserAndProject(
    parsed.data.targetProjectId,
  );

  if (
    sourceContext.workspace.id !== targetContext.workspace.id ||
    sourceContext.project.id === targetContext.project.id
  ) {
    return { error: "Choose another active project in this workspace." };
  }

  const sourceAction = await getProjectAction(
    sourceContext.project.id,
    parsed.data.sourceActionId,
  );
  if (!sourceAction) {
    return { error: "The source action is no longer available." };
  }

  const exportData = await buildProjectActionFlowExport({
    actionId: sourceAction.id,
    project: sourceContext.project,
  });
  if (!exportData) {
    return { error: "The source action could not be prepared for cloning." };
  }

  const references = collectActionFlowResourceReferences(exportData);
  const resources = await loadActionFlowCloneResources(
    targetContext.project.id,
  );
  const resourceMappings: Required<ActionFlowResourceMappings> = {
    catalogs: {},
    catalogProducts: {},
    connectedActions: {},
    conversationalTaskVersions: {},
    mediaAssets: {},
    operations: {},
  };

  for (const reference of references) {
    const fieldName = getActionFlowCloneResourceFieldName(
      reference.kind,
      reference.sourceId,
    );
    const rawTargetId = formData.get(fieldName);
    if (typeof rawTargetId !== "string") {
      return { error: "Review every referenced resource before cloning." };
    }

    const targetId =
      rawTargetId === ACTION_FLOW_CLONE_DISCONNECTED_VALUE
        ? null
        : Number(rawTargetId);
    if (
      targetId !== null &&
      (!Number.isInteger(targetId) ||
        targetId <= 0 ||
        !hasActionFlowCloneResource(reference.kind, targetId, resources))
    ) {
      return { error: "A selected target resource is no longer available." };
    }

    switch (reference.kind) {
      case "catalog":
        resourceMappings.catalogs[reference.sourceId] = targetId;
        break;
      case "catalog_product":
        resourceMappings.catalogProducts[reference.sourceId] = targetId;
        break;
      case "connected_action":
        resourceMappings.connectedActions[reference.sourceId] = targetId;
        break;
      case "conversational_task_version":
        resourceMappings.conversationalTaskVersions[reference.sourceId] =
          targetId === null
            ? null
            : (resources.conversationalTaskVersions.find(
                (task) => task.taskVersionId === targetId,
              ) ?? null);
        break;
      case "media_asset":
        resourceMappings.mediaAssets[reference.sourceId] = targetId;
        break;
      case "operation":
        resourceMappings.operations[reference.sourceId] = targetId;
        break;
    }
  }

  const cloned = await importActionFlowExport({
    exportData,
    nameOverride: parsed.data.name,
    projectId: targetContext.project.id,
    resourceMappings,
  });

  await writeAuditLog({
    ...targetContext,
    action: "chatbot_action.cloned",
    targetType: "project_action",
    targetId: cloned.actionId,
    metadata: {
      branchRuleCount: cloned.branchRuleCount,
      mappedResourceCount: references.length,
      skippedBranchRuleCount: cloned.skippedBranchRuleCount,
      sourceActionId: sourceAction.id,
      sourceProjectId: sourceContext.project.id,
      stepCount: cloned.stepCount,
    },
  });

  await setActiveProjectCookie(targetContext.project.id);
  revalidatePath("/projects/actions");
  revalidatePath(`/projects/actions/${cloned.actionId}`);
  redirect(`/projects/actions/${cloned.actionId}?cloned=1`);
}
