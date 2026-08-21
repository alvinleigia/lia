import { expect, test } from "@playwright/test";
import {
  DEFAULT_CONVERSATION_PROJECT_POLICY,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
} from "../../src/lib/conversation-contracts";
import {
  buildConversationalTaskSnapshot,
  conversationalTaskSnapshotsMatch,
} from "../../src/lib/conversational-task-versioning";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

function buildSnapshot(objective = "Collect a booking request.") {
  return buildConversationalTaskSnapshot({
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    conversationPolicy: DEFAULT_CONVERSATION_PROJECT_POLICY,
    task: {
      definition: DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
      description: null,
      id: 17,
      name: "Booking",
      objective,
      schemaVersion: 1,
    },
    toolDefinitions: [],
  });
}

test("detects an unchanged conversational task snapshot", () => {
  const snapshot = buildSnapshot();

  expect(conversationalTaskSnapshotsMatch(snapshot, snapshot)).toBe(true);
});

test("detects a changed conversational task snapshot", () => {
  const published = buildSnapshot();
  const changed = buildSnapshot("Collect and confirm a booking request.");

  expect(conversationalTaskSnapshotsMatch(changed, published)).toBe(false);
});
