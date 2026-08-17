"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type ActionFlowVersionSnapshot,
  getActionFlowVersion,
  getProjectAction,
} from "@/lib/action-flows";
import { writeAuditLog } from "@/lib/audit";
import {
  AUTOMATED_FLOW_TEST_AUDIT_ACTION,
  AUTOMATED_FLOW_TEST_TARGET_TYPE,
  runAutomatedHybridFlowTest,
} from "@/lib/hybrid-flow-automated-test";
import { runBehavioralHybridFlowTest } from "@/lib/hybrid-flow-behavioral-test";
import { runCombinationHybridFlowTest } from "@/lib/hybrid-flow-combination-test";
import { compiledHybridFlowGraphV1Schema } from "@/lib/hybrid-flow-contracts";
import { runOperationHybridFlowTest } from "@/lib/hybrid-flow-operation-test";
import { runResourceBackedHybridFlowTest } from "@/lib/hybrid-flow-resource-test";
import { resolveStrictPageUserAndProject } from "@/lib/protected-page";

const automatedTestInputSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  versionId: z.coerce.number().int().positive(),
});

function testPagePath(actionId: number, message?: string) {
  const path = `/projects/actions/${actionId}/hybrid-test`;
  return message
    ? `${path}?automatedTestError=${encodeURIComponent(message)}`
    : `${path}?automatedTest=completed`;
}

export async function runAutomatedFlowTestAction(formData: FormData) {
  const parsed = automatedTestInputSchema.safeParse({
    actionId: formData.get("actionId"),
    projectId: formData.get("projectId"),
    versionId: formData.get("versionId"),
  });

  if (!parsed.success) {
    redirect("/projects/actions?error=Invalid%20automated%20test%20request.");
  }

  const context = await resolveStrictPageUserAndProject(parsed.data.projectId);
  const { project } = context;
  const action = await getProjectAction(project.id, parsed.data.actionId);
  if (!action || action.publishedVersionId !== parsed.data.versionId) {
    redirect(
      testPagePath(
        parsed.data.actionId,
        "The selected published version is no longer active.",
      ),
    );
  }

  const version = await getActionFlowVersion(
    project.id,
    action.id,
    parsed.data.versionId,
  );
  const graph = version
    ? compiledHybridFlowGraphV1Schema.safeParse(
        (version.snapshot as { hybridGraph?: unknown }).hybridGraph,
      )
    : null;

  if (!version || !graph?.success) {
    redirect(
      testPagePath(
        action.id,
        "The published graph could not be loaded. Publish a valid version and try again.",
      ),
    );
  }

  const structuralReport = runAutomatedHybridFlowTest(graph.data);
  const snapshot = version.snapshot as ActionFlowVersionSnapshot;
  const behavioralReport = runBehavioralHybridFlowTest(snapshot.steps ?? []);
  const combinationReport = runCombinationHybridFlowTest({
    graph: graph.data,
    snapshot,
    versionId: version.id,
    versionNumber: version.versionNumber,
  });
  const resourceReport = runResourceBackedHybridFlowTest(snapshot.steps ?? []);
  const operationReport = runOperationHybridFlowTest({
    graph: graph.data,
    snapshot,
    versionId: version.id,
    versionNumber: version.versionNumber,
  });
  const report = {
    ...structuralReport,
    behavioral: behavioralReport,
    combinations: combinationReport,
    errors: [
      ...structuralReport.errors,
      ...behavioralReport.errors,
      ...combinationReport.errors,
      ...resourceReport.errors,
      ...operationReport.errors,
    ],
    operations: operationReport,
    resources: resourceReport,
    status:
      structuralReport.status === "passed" &&
      behavioralReport.status === "passed" &&
      combinationReport.status === "passed" &&
      resourceReport.status === "passed" &&
      operationReport.status === "passed"
        ? ("passed" as const)
        : ("failed" as const),
    warnings: [
      ...structuralReport.warnings,
      ...behavioralReport.warnings,
      ...combinationReport.warnings,
      ...resourceReport.warnings,
      ...operationReport.warnings,
    ],
  };
  await writeAuditLog({
    ...context,
    action: AUTOMATED_FLOW_TEST_AUDIT_ACTION,
    targetId: version.id,
    targetType: AUTOMATED_FLOW_TEST_TARGET_TYPE,
    metadata: {
      actionId: action.id,
      report,
      versionId: version.id,
      versionNumber: version.versionNumber,
    },
  });

  const path = testPagePath(action.id);
  revalidatePath(`/projects/actions/${action.id}/hybrid-test`);
  redirect(path);
}
