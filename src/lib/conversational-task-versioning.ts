import {
  type ConversationalTaskDefinitionV1,
  type ConversationalTaskSnapshotV1,
  type ConversationProjectPolicyV1,
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import type { ProjectAiSettings } from "@/lib/project-ai-settings";

type TaskSnapshotInput = {
  assistantBehavior: ProjectAiSettings;
  conversationPolicy: ConversationProjectPolicyV1;
  task: {
    definition: ConversationalTaskDefinitionV1;
    description: string | null;
    id: number;
    name: string;
    objective: string;
    schemaVersion: number;
  };
  toolDefinitions: ToolDefinitionV1[];
};

export function buildConversationalTaskSnapshot(input: TaskSnapshotInput) {
  return conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: input.assistantBehavior,
    assistantPolicy: input.conversationPolicy.assistant,
    conversationPolicy: input.conversationPolicy,
    toolDefinitions: input.toolDefinitions,
    task: input.task,
  });
}

export function conversationalTaskSnapshotsMatch(
  current: ConversationalTaskSnapshotV1,
  published: unknown,
) {
  const parsed = conversationalTaskSnapshotV1Schema.safeParse(published);
  return parsed.success && stableJson(current) === stableJson(parsed.data);
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }

  return value;
}
