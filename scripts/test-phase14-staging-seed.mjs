import assert from "node:assert/strict";
import {
  assertSanitizedConfiguration,
  buildActionSnapshot,
  buildTaskSnapshot,
  remapOperationReferences,
  remapTaskSnapshotProjectIds,
  remapTaskWrapperSettings,
} from "./lib/phase14-staging-fixture.mjs";

const taskSettings = {
  conversationalTask: {
    task: { taskId: 3, taskVersionId: 37, versionNumber: 4 },
  },
};

const remappedSettings = remapTaskWrapperSettings({
  settings: taskSettings,
  sourceTaskId: 3,
  sourceTaskVersionId: 37,
  targetTaskId: 30,
  targetTaskVersionId: 370,
});
assert.equal(remappedSettings.conversationalTask.task.taskId, 30);
assert.equal(remappedSettings.conversationalTask.task.taskVersionId, 370);
assert.equal(taskSettings.conversationalTask.task.taskId, 3);

const taskSnapshot = buildTaskSnapshot({
  snapshot: {
    task: { id: 3, definition: { tools: [{ id: "operation:204" }] } },
    toolDefinitions: [
      {
        execution: { adapter: "operation", handler: "204" },
        id: "operation:204",
        projectId: 194,
      },
    ],
  },
  sourceOperationId: 204,
  sourceProjectId: 194,
  sourceTaskId: 3,
  targetOperationId: 904,
  targetProjectId: 1,
  targetTaskId: 30,
});
assert.equal(taskSnapshot.task.id, 30);
assert.equal(taskSnapshot.task.definition.tools[0].id, "operation:904");
assert.equal(taskSnapshot.toolDefinitions[0].id, "operation:904");
assert.equal(taskSnapshot.toolDefinitions[0].execution.handler, "904");
assert.equal(taskSnapshot.toolDefinitions[0].projectId, 1);
assert.equal(
  remapTaskSnapshotProjectIds(taskSnapshot, 194, 1).toolDefinitions[0]
    .projectId,
  1,
);

const sourceActionSnapshot = {
  action: {
    id: 638,
    name: "Phase 13 Booking Parity UAT",
    status: "active",
    description: "Source",
    triggerPhrases: ["phase thirteen booking parity"],
  },
  steps: [
    {
      id: 1772,
      label: "Run Phase 13 booking",
      settings: taskSettings,
    },
  ],
  hybridGraph: {
    entryNodeId: "step:1772",
    nodes: [
      {
        id: "step:1772",
        label: "Run Phase 13 booking",
        sourceStepId: 1772,
        settings: { task: { taskId: 3, taskVersionId: 37 } },
      },
    ],
    transitions: [
      {
        id: "step:1772:task_outcome:completed",
        sourceNodeId: "step:1772",
      },
    ],
  },
};
const actionSnapshot = buildActionSnapshot({
  actionDescription: "Target",
  actionName: "Book a Spa Service",
  actionSnapshot: sourceActionSnapshot,
  actionTriggerPhrases: ["book a spa service"],
  publishedAt: "2026-08-06T00:00:00.000Z",
  sourceActionId: 638,
  sourceStepId: 1772,
  sourceTaskId: 3,
  sourceTaskVersionId: 37,
  targetActionId: 900,
  targetStepId: 901,
  targetTaskId: 902,
  targetTaskVersionId: 903,
});
assert.equal(actionSnapshot.action.id, 900);
assert.equal(actionSnapshot.action.name, "Book a Spa Service");
assert.equal(actionSnapshot.steps[0].id, 901);
assert.equal(
  actionSnapshot.steps[0].settings.conversationalTask.task.taskId,
  902,
);
assert.equal(actionSnapshot.hybridGraph.entryNodeId, "step:901");
assert.equal(actionSnapshot.hybridGraph.nodes[0].sourceStepId, 901);
assert.equal(
  actionSnapshot.hybridGraph.nodes[0].settings.task.taskVersionId,
  903,
);
assert.equal(
  actionSnapshot.hybridGraph.transitions[0].id,
  "step:901:task_outcome:completed",
);
assert.equal(sourceActionSnapshot.action.id, 638);

assert.deepEqual(remapOperationReferences({ id: "operation:204" }, 204, 905), {
  id: "operation:905",
});
assert.doesNotThrow(() =>
  assertSanitizedConfiguration("safe", { maxOutputTokens: 600 }),
);
assert.throws(
  () => assertSanitizedConfiguration("unsafe", { accessToken: "value" }),
  /disallowed credential key/,
);
assert.throws(
  () => assertSanitizedConfiguration("unsafe", { value: "postgres://x:y@z" }),
  /credential-like value/,
);

console.log("Phase 14 staging seed transformation checks passed.");
