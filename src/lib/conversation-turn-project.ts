import { and, asc, desc, eq } from "drizzle-orm";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
} from "@/lib/conversation-contracts";
import type {
  TurnContextValueV1,
  TurnFieldStateV1,
} from "@/lib/conversation-turn-contracts";
import { db } from "@/lib/db-config";
import {
  conversationalTasks,
  conversationalTaskVersions,
} from "@/lib/db-schema";

export async function listLatestPublishedTurnTasks(projectId: number) {
  const versions = await db
    .select({
      taskId: conversationalTasks.id,
      name: conversationalTasks.name,
      objective: conversationalTasks.objective,
      snapshot: conversationalTaskVersions.snapshot,
      versionId: conversationalTaskVersions.id,
      versionNumber: conversationalTaskVersions.versionNumber,
    })
    .from(conversationalTaskVersions)
    .innerJoin(
      conversationalTasks,
      and(
        eq(conversationalTasks.id, conversationalTaskVersions.taskId),
        eq(conversationalTasks.projectId, conversationalTaskVersions.projectId),
      ),
    )
    .where(
      and(
        eq(conversationalTaskVersions.projectId, projectId),
        eq(conversationalTasks.isArchived, false),
      ),
    )
    .orderBy(
      asc(conversationalTasks.id),
      desc(conversationalTaskVersions.versionNumber),
    );
  const latest = new Map<number, (typeof versions)[number]>();

  for (const version of versions) {
    if (!latest.has(version.taskId)) latest.set(version.taskId, version);
  }

  return [...latest.values()].map((version) => ({
    ...version,
    snapshot: conversationalTaskSnapshotV1Schema.parse(version.snapshot),
  }));
}

export function initializeTurnFieldState(
  snapshot: ConversationalTaskSnapshotV1,
): TurnFieldStateV1[] {
  return snapshot.task.definition.fields.map((field) => ({
    fieldKey: field.key,
    label: field.label,
    state: "missing",
    required: field.required,
    sensitivity: field.sensitivity,
    value: null,
  }));
}

export function selectModelVisibleTurnContext(
  snapshot: ConversationalTaskSnapshotV1,
): TurnContextValueV1[] {
  return snapshot.task.definition.contextVariables.flatMap((variable) => {
    if (variable.defaultValue === null) return [];
    return [
      {
        key: variable.key,
        modelVisible: variable.modelVisible,
        sensitivity: variable.sensitivity,
        value: variable.defaultValue,
      },
    ];
  });
}
