const SENSITIVE_KEY_NAMES = new Set([
  "accesstoken",
  "apikey",
  "appsecret",
  "authenticationtag",
  "authorization",
  "ciphertext",
  "clientsecret",
  "initializationvector",
  "password",
  "passwordhash",
  "secret",
  "secretname",
  "tokenhash",
  "verifytoken",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /^Bearer\s+/i,
  /^postgres(?:ql)?:\/\//i,
  /^sk-[A-Za-z0-9_-]{12,}$/,
];

function normalizedKey(key) {
  return key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

function cloneValue(value) {
  return structuredClone(value);
}

function visit(value, path, visitor) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      visit(item, `${path}[${index}]`, visitor),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        visit(item, `${path}.${key}`, visitor),
      ]),
    );
  }

  return visitor(value, path);
}

export function assertSanitizedConfiguration(label, value) {
  const inspect = (current, path) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        inspect(item, `${path}[${index}]`);
      });
      return;
    }

    if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) {
        if (SENSITIVE_KEY_NAMES.has(normalizedKey(key))) {
          throw new Error(
            `${label} contains disallowed credential key at ${path}.${key}.`,
          );
        }
        inspect(item, `${path}.${key}`);
      }
      return;
    }

    if (
      typeof current === "string" &&
      SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(current.trim()))
    ) {
      throw new Error(`${label} contains a credential-like value at ${path}.`);
    }
  };

  inspect(value, "$fixture");
}

export function remapOperationReferences(value, sourceId, targetId) {
  const sourceReference = `operation:${sourceId}`;
  const targetReference = `operation:${targetId}`;

  return visit(cloneValue(value), "$", (item, path) => {
    if (typeof item !== "string") return item;
    if (path.endsWith(".execution.handler") && item === String(sourceId)) {
      return String(targetId);
    }
    return item.replaceAll(sourceReference, targetReference);
  });
}

export function remapTaskSnapshotProjectIds(
  snapshot,
  sourceProjectId,
  targetProjectId,
) {
  const remapped = cloneValue(snapshot);
  for (const definition of remapped.toolDefinitions ?? []) {
    if (
      definition.projectId !== sourceProjectId &&
      definition.projectId !== targetProjectId
    ) {
      throw new Error(
        "Source task snapshot contains a tool for an unexpected project.",
      );
    }
    definition.projectId = targetProjectId;
  }
  return remapped;
}

export function buildTaskSnapshot({
  snapshot,
  sourceOperationId,
  sourceProjectId,
  sourceTaskId,
  targetOperationId,
  targetProjectId,
  targetTaskId,
}) {
  const remapped = remapTaskSnapshotProjectIds(
    remapOperationReferences(snapshot, sourceOperationId, targetOperationId),
    sourceProjectId,
    targetProjectId,
  );

  if (!remapped.task || remapped.task.id !== sourceTaskId) {
    throw new Error("Source task snapshot does not match the expected task.");
  }

  remapped.task.id = targetTaskId;
  return remapped;
}

export function remapTaskWrapperSettings({
  settings,
  sourceTaskId,
  sourceTaskVersionId,
  targetTaskId,
  targetTaskVersionId,
}) {
  const remapped = cloneValue(settings);
  const task = remapped?.conversationalTask?.task;

  if (
    !task ||
    task.taskId !== sourceTaskId ||
    task.taskVersionId !== sourceTaskVersionId
  ) {
    throw new Error(
      "Source action step does not point to the expected task v4.",
    );
  }

  task.taskId = targetTaskId;
  task.taskVersionId = targetTaskVersionId;
  return remapped;
}

export function buildActionSnapshot({
  actionDescription,
  actionName,
  actionSnapshot,
  actionTriggerPhrases,
  publishedAt,
  sourceActionId,
  sourceStepId,
  sourceTaskId,
  sourceTaskVersionId,
  targetActionId,
  targetStepId,
  targetTaskId,
  targetTaskVersionId,
}) {
  const sourceStepReference = `step:${sourceStepId}`;
  const targetStepReference = `step:${targetStepId}`;
  const remapped = visit(cloneValue(actionSnapshot), "$", (item) =>
    typeof item === "string"
      ? item.replaceAll(sourceStepReference, targetStepReference)
      : item,
  );

  if (!remapped.action || remapped.action.id !== sourceActionId) {
    throw new Error(
      "Source action snapshot does not match the expected action.",
    );
  }

  remapped.action.id = targetActionId;
  remapped.action.name = actionName;
  remapped.action.description = actionDescription;
  remapped.action.status = "active";
  remapped.action.triggerPhrases = [...actionTriggerPhrases];
  remapped.publishedAt = publishedAt;

  if (!Array.isArray(remapped.steps) || remapped.steps.length !== 1) {
    throw new Error("Source action snapshot must contain exactly one step.");
  }

  const [step] = remapped.steps;
  if (step.id !== sourceStepId) {
    throw new Error("Source action snapshot contains an unexpected step.");
  }
  step.id = targetStepId;
  step.label = "Run Phase 14 booking";
  step.settings = remapTaskWrapperSettings({
    settings: step.settings,
    sourceTaskId,
    sourceTaskVersionId,
    targetTaskId,
    targetTaskVersionId,
  });

  const nodes = remapped.hybridGraph?.nodes;
  if (!Array.isArray(nodes) || nodes.length !== 1) {
    throw new Error(
      "Source action snapshot must contain one hybrid graph node.",
    );
  }

  const [node] = nodes;
  if (node.sourceStepId !== sourceStepId) {
    throw new Error("Source hybrid graph contains an unexpected step.");
  }
  node.sourceStepId = targetStepId;
  node.label = "Run Phase 14 booking";

  if (
    node.settings?.task?.taskId !== sourceTaskId ||
    node.settings?.task?.taskVersionId !== sourceTaskVersionId
  ) {
    throw new Error(
      "Source hybrid graph does not point to the expected task v4.",
    );
  }
  node.settings.task.taskId = targetTaskId;
  node.settings.task.taskVersionId = targetTaskVersionId;

  return remapped;
}
