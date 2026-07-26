function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function remapStepId(value: unknown, stepIdMap: Map<number, number>) {
  if (value === "end") {
    return value;
  }
  return typeof value === "number" ? (stepIdMap.get(value) ?? "end") : value;
}

function remapEntryRoutes(value: unknown, stepIdMap: Map<number, number>) {
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, stepId]) => {
      const mapped =
        typeof stepId === "number" ? stepIdMap.get(stepId) : undefined;
      return mapped ? [[key, mapped]] : [];
    }),
  );
}

export function remapHybridEntryPolicySettings(
  settings: Record<string, unknown>,
  stepIdMap: Map<number, number>,
) {
  if (!isRecord(settings.hybridEntryPolicy)) {
    return settings;
  }
  const entryPolicy = settings.hybridEntryPolicy;
  return {
    ...settings,
    hybridEntryPolicy: {
      ...entryPolicy,
      campaignRoutes: remapEntryRoutes(entryPolicy.campaignRoutes, stepIdMap),
      channelRoutes: remapEntryRoutes(entryPolicy.channelRoutes, stepIdMap),
      deepLinkRoutes: remapEntryRoutes(entryPolicy.deepLinkRoutes, stepIdMap),
      normalStepId:
        typeof entryPolicy.normalStepId === "number"
          ? (stepIdMap.get(entryPolicy.normalStepId) ?? null)
          : null,
    },
  };
}

export function remapHybridStepSettings(
  settings: Record<string, unknown>,
  stepIdMap: Map<number, number>,
) {
  let next = settings;

  if (isRecord(settings.knowledgeConversation)) {
    const knowledge = settings.knowledgeConversation;
    next = {
      ...next,
      knowledgeConversation: {
        ...knowledge,
        answeredRoute: remapStepId(knowledge.answeredRoute, stepIdMap),
        handoffRoute: remapStepId(knowledge.handoffRoute, stepIdMap),
        noAnswerRoute: remapStepId(knowledge.noAnswerRoute, stepIdMap),
        recommendationTargetStepIds: Array.isArray(
          knowledge.recommendationTargetStepIds,
        )
          ? knowledge.recommendationTargetStepIds.flatMap((stepId) => {
              const mapped =
                typeof stepId === "number" ? stepIdMap.get(stepId) : undefined;
              return mapped ? [mapped] : [];
            })
          : knowledge.recommendationTargetStepIds,
      },
    };
  }

  if (isRecord(settings.conversationalTask)) {
    const task = settings.conversationalTask;
    next = {
      ...next,
      conversationalTask: {
        ...task,
        outcomeRoutes: isRecord(task.outcomeRoutes)
          ? Object.fromEntries(
              Object.entries(task.outcomeRoutes).map(([key, value]) => [
                key,
                remapStepId(value, stepIdMap),
              ]),
            )
          : task.outcomeRoutes,
      },
    };
  }

  return next;
}
